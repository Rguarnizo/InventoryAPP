import { useEffect, useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Card,
  Grid,
  Group,
  List,
  Loader,
  Modal,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowLeft, IconInfoCircle } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api/client';
import type { BatchDetail, BatchStatus, Material, Page, ProductDetail } from '../api/types';
import { BatchMaterialRow, BatchMaterialsEditor } from '../components/BatchMaterialsEditor';
import { PageHeader } from '../components/PageHeader';
import { ProductThumb } from '../components/ProductThumb';
import { StatusBadge } from '../components/StatusBadge';
import { date, money, percent, qty } from '../lib/format';
import { notifyError, notifyOk } from '../lib/notify';

interface Shortage {
  material: string;
  required: number;
  available: number;
  unit: Material['unit'];
}

interface StatusPayload {
  status: BatchStatus;
  produced_quantity?: number;
  defective_quantity?: number;
  force?: boolean;
}

export function BatchPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const batch = useQuery({ queryKey: ['batches', Number(id)], queryFn: () => api.get<BatchDetail>(`/batches/${id}`) });
  const product = useQuery({
    queryKey: ['products', batch.data?.product.id],
    queryFn: () => api.get<ProductDetail>(`/products/${batch.data!.product.id}`),
    enabled: !!batch.data,
  });
  const materials = useQuery({
    queryKey: ['materials', 'all'],
    queryFn: () => api.get<Page<Material>>('/materials', { size: 500 }),
  });

  const [info, setInfo] = useState({ code: '', production_date: '', planned_quantity: 1, notes: '' });
  const [rows, setRows] = useState<BatchMaterialRow[]>([]);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!batch.data) return;
    const b = batch.data;
    setInfo({ code: b.code, production_date: b.production_date, planned_quantity: b.planned_quantity, notes: b.notes ?? '' });
    setRows(b.materials.map((m) => ({ material_id: m.material.id, quantity: m.quantity })));
  }, [batch.data]);

  const invalidate = () => {
    for (const key of ['batches', 'materials', 'products', 'dashboard']) queryClient.invalidateQueries({ queryKey: [key] });
  };

  const save = useMutation({
    mutationFn: () => {
      const b = batch.data!;
      const body: Record<string, unknown> = { code: info.code, production_date: info.production_date, notes: info.notes || null };
      if (b.status === 'planificado' || b.status === 'en_proceso') body.planned_quantity = info.planned_quantity;
      if (!b.materials_consumed) body.materials = rows.filter((r) => r.material_id && r.quantity > 0);
      return api.put<BatchDetail>(`/batches/${id}`, body);
    },
    onSuccess: () => {
      invalidate();
      notifyOk('Lote guardado');
    },
    onError: notifyError,
  });

  const changeStatus = useMutation({
    mutationFn: (payload: StatusPayload) => api.post<BatchDetail>(`/batches/${id}/status`, payload),
    onSuccess: (b) => {
      invalidate();
      setFinishing(false);
      notifyOk(`Lote ${b.code}: ${b.status.replace('_', ' ')}`);
    },
    onError: (error, payload) => {
      const detail = error instanceof ApiError ? (error.detail as { shortages?: Shortage[] }) : null;
      if (error instanceof ApiError && error.status === 409 && detail?.shortages) {
        modals.openConfirmModal({
          title: 'Stock insuficiente de materia prima',
          children: (
            <>
              <List size="sm" mb="sm">
                {detail.shortages.map((s) => (
                  <List.Item key={s.material}>
                    <b>{s.material}</b>: se necesitan {qty(s.required, s.unit)}, hay {qty(s.available, s.unit)}
                  </List.Item>
                ))}
              </List>
              <Text size="sm">
                Puedes continuar de todas formas (el stock quedará negativo) y registrar la compra después en Materia prima.
              </Text>
            </>
          ),
          labels: { confirm: 'Continuar de todas formas', cancel: 'Cancelar' },
          confirmProps: { color: 'orange' },
          onConfirm: () => changeStatus.mutate({ ...payload, force: true }),
        });
      } else if (error instanceof ApiError && error.status === 409 && payload.status === 'cancelado' && !payload.force) {
        modals.openConfirmModal({
          title: 'No se puede revertir el stock',
          children: <Text size="sm">{error.message}</Text>,
          labels: { confirm: 'Forzar cancelación', cancel: 'Volver' },
          confirmProps: { color: 'red' },
          onConfirm: () => changeStatus.mutate({ ...payload, force: true }),
        });
      } else {
        notifyError(error);
      }
    },
  });

  const confirm = (title: string, text: string, payload: StatusPayload, color = 'grape') =>
    modals.openConfirmModal({
      title,
      children: <Text size="sm">{text}</Text>,
      labels: { confirm: 'Confirmar', cancel: 'Volver' },
      confirmProps: { color },
      onConfirm: () => changeStatus.mutate(payload),
    });

  const remove = () =>
    modals.openConfirmModal({
      title: 'Eliminar lote',
      children: <Text size="sm">¿Eliminar el lote {batch.data?.code}?</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Volver' },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        api
          .delete(`/batches/${id}`)
          .then(() => {
            invalidate();
            navigate('/lotes');
          })
          .catch(notifyError),
    });

  if (batch.isLoading || !batch.data) return <Loader />;
  const b = batch.data;
  const frozen = Object.fromEntries(b.materials.map((m) => [m.material.id, m.unit_cost]));
  const price = product.data?.sale_price || product.data?.min_price;
  const editableMaterials = !b.materials_consumed;
  const editableQuantity = b.status === 'planificado' || b.status === 'en_proceso';

  const actions: React.ReactNode[] = [];
  if (b.status === 'planificado') {
    actions.push(
      <Button key="start" variant="light" onClick={() => confirm('Iniciar producción', 'Se descontará la materia prima del inventario.', { status: 'en_proceso' })}>
        Iniciar (descontar materiales)
      </Button>,
    );
  }
  if (b.status === 'planificado' || b.status === 'en_proceso') {
    actions.push(
      <Button key="finish" color="teal" onClick={() => setFinishing(true)}>
        Terminar lote
      </Button>,
    );
  }
  if (b.status === 'en_proceso') {
    actions.push(
      <Button key="back" variant="default" onClick={() => confirm('Volver a planificado', 'Se devolverá la materia prima al inventario.', { status: 'planificado' })}>
        Volver a planificado
      </Button>,
    );
  }
  if (b.status !== 'cancelado') {
    actions.push(
      <Button
        key="cancel"
        variant="subtle"
        color="red"
        onClick={() =>
          confirm(
            'Cancelar lote',
            b.status === 'terminado'
              ? 'Se restarán las unidades del stock del producto y se devolverá la materia prima.'
              : 'Se devolverá la materia prima descontada (si la hay).',
            { status: 'cancelado' },
            'red',
          )
        }
      >
        Cancelar lote
      </Button>,
    );
  } else {
    actions.push(
      <Button key="reopen" variant="default" onClick={() => changeStatus.mutate({ status: 'planificado' })}>
        Reabrir
      </Button>,
    );
  }
  if (b.status === 'planificado' || b.status === 'cancelado') {
    actions.push(
      <Button key="delete" variant="subtle" color="red" onClick={remove}>
        Eliminar
      </Button>,
    );
  }

  return (
    <>
      <Anchor component={Link} to="/lotes" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Lotes
        </Group>
      </Anchor>
      <PageHeader
        title={
          <Group gap="sm">
            {b.code} <StatusBadge status={b.status} />
          </Group>
        }
        subtitle={`${date(b.production_date)} · ${b.product.name}`}
        actions={actions}
      />

      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack>
            <Card withBorder>
              <Group gap="sm" mb="md" wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => navigate(`/productos/${b.product.id}`)}>
                <ProductThumb url={b.product.thumb_url} type={b.product.type} size={56} />
                <div>
                  <Text fw={700}>{b.product.name}</Text>
                  <Text size="xs" c="dimmed">
                    {b.product.code}
                  </Text>
                </div>
              </Group>
              <Table>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>Planificadas</Table.Td>
                    <Table.Td ta="right">{b.planned_quantity}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Producidas</Table.Td>
                    <Table.Td ta="right">{b.produced_quantity ?? '—'}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Defectuosas</Table.Td>
                    <Table.Td ta="right">{b.defective_quantity}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Costo total</Table.Td>
                    <Table.Td ta="right" fw={700}>
                      {money(b.total_cost)}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Costo por unidad buena</Table.Td>
                    <Table.Td ta="right" fw={700}>
                      {money(b.unit_cost)}
                    </Table.Td>
                  </Table.Tr>
                  {product.data && (
                    <Table.Tr>
                      <Table.Td>Costo estimado (receta)</Table.Td>
                      <Table.Td ta="right">{money(product.data.estimated_cost)}</Table.Td>
                    </Table.Tr>
                  )}
                  {price && b.unit_cost !== null ? (
                    <Table.Tr>
                      <Table.Td>Margen sobre {money(price)}</Table.Td>
                      <Table.Td ta="right">{percent((price - b.unit_cost) / price)}</Table.Td>
                    </Table.Tr>
                  ) : null}
                </Table.Tbody>
              </Table>
            </Card>
            <Card withBorder>
              <Stack>
                <TextInput label="Código" value={info.code} onChange={(e) => setInfo({ ...info, code: e.currentTarget.value })} />
                <TextInput
                  label="Fecha de producción"
                  type="date"
                  value={info.production_date}
                  onChange={(e) => setInfo({ ...info, production_date: e.currentTarget.value })}
                />
                {editableQuantity && (
                  <NumberInput
                    label="Unidades planificadas"
                    value={info.planned_quantity}
                    onChange={(v) => setInfo({ ...info, planned_quantity: Number(v) || 1 })}
                    min={1}
                    allowDecimal={false}
                  />
                )}
                <Textarea label="Notas" value={info.notes} onChange={(e) => setInfo({ ...info, notes: e.currentTarget.value })} autosize minRows={2} />
                <Button onClick={() => save.mutate()} loading={save.isPending}>
                  Guardar cambios
                </Button>
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder>
            <Title order={5} mb="xs">
              Materia prima del lote
            </Title>
            {b.materials_consumed ? (
              <Alert icon={<IconInfoCircle size={18} />} color="blue" mb="sm" p="xs">
                Los materiales ya se descontaron del inventario con el costo de ese momento. Para editarlos, vuelve el lote a «planificado».
              </Alert>
            ) : (
              <Text size="sm" c="dimmed" mb="sm">
                Ajusta las cantidades reales si usaste más o menos; se descontarán al iniciar o terminar el lote.
              </Text>
            )}
            <BatchMaterialsEditor
              rows={rows}
              onChange={editableMaterials ? setRows : undefined}
              materials={materials.data?.items ?? []}
              frozenCosts={b.materials_consumed ? frozen : undefined}
              showStock={editableMaterials}
            />
          </Card>
        </Grid.Col>
      </Grid>

      <FinishModal
        opened={finishing}
        planned={b.planned_quantity}
        loading={changeStatus.isPending}
        onClose={() => setFinishing(false)}
        onConfirm={(produced, defective) =>
          changeStatus.mutate({ status: 'terminado', produced_quantity: produced, defective_quantity: defective })
        }
      />
    </>
  );
}

function FinishModal(props: {
  opened: boolean;
  planned: number;
  loading: boolean;
  onClose: () => void;
  onConfirm: (produced: number, defective: number) => void;
}) {
  const [produced, setProduced] = useState(props.planned);
  const [defective, setDefective] = useState(0);

  useEffect(() => setProduced(props.planned), [props.planned]);

  return (
    <Modal opened={props.opened} onClose={props.onClose} title="Terminar lote">
      <Stack>
        <NumberInput label="Unidades producidas" value={produced} onChange={(v) => setProduced(Number(v) || 0)} min={0} allowDecimal={false} />
        <NumberInput
          label="Unidades defectuosas"
          value={defective}
          onChange={(v) => setDefective(Number(v) || 0)}
          min={0}
          max={produced}
          allowDecimal={false}
        />
        <Text size="sm">
          Se sumarán <b>{Math.max(produced - defective, 0)}</b> unidades al stock del producto. Si los materiales no se habían descontado, se descontarán ahora.
        </Text>
        <Button color="teal" onClick={() => props.onConfirm(produced, defective)} loading={props.loading}>
          Terminar
        </Button>
      </Stack>
    </Modal>
  );
}
