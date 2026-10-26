import { useEffect, useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Card,
  Divider,
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
import type { BatchDetail, BatchItem, BatchPreview, BatchStatus, Material, Mixture, Page, Product } from '../api/types';
import { BatchItemRow, BatchItemsEditor, newItemRow, toItemInputs } from '../components/BatchItemsEditor';
import { BatchMaterialRow, BatchMaterialsEditor } from '../components/BatchMaterialsEditor';
import { PageHeader } from '../components/PageHeader';
import { ProductThumb } from '../components/ProductThumb';
import { ProfitSummary } from '../components/ProfitSummary';
import { StatusBadge } from '../components/StatusBadge';
import { date, money, percent, qty } from '../lib/format';
import { notifyError, notifyOk } from '../lib/notify';

interface Shortage {
  material: string;
  required: number;
  available: number;
  unit: Material['unit'];
}

interface ItemResult {
  item_id: number;
  produced_quantity: number;
  defective_quantity: number;
}

interface StatusPayload {
  status: BatchStatus;
  results?: ItemResult[];
  force?: boolean;
}

const toRows = (items: BatchItem[]): BatchItemRow[] =>
  items.map((i) => ({ ...newItemRow(i.product.id, i.planned_quantity) }));

export function BatchPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const batch = useQuery({ queryKey: ['batches', Number(id)], queryFn: () => api.get<BatchDetail>(`/batches/${id}`) });
  const products = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api.get<Page<Product>>('/products', { size: 500, sort: 'name' }),
  });
  const mixtures = useQuery({ queryKey: ['mixtures'], queryFn: () => api.get<Mixture[]>('/mixtures') });
  const materials = useQuery({
    queryKey: ['materials', 'all'],
    queryFn: () => api.get<Page<Material>>('/materials', { size: 500 }),
  });

  const [info, setInfo] = useState({ code: '', production_date: '', notes: '' });
  const [rows, setRows] = useState<BatchMaterialRow[]>([]);
  const [items, setItems] = useState<BatchItemRow[] | null>(null);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!batch.data) return;
    const b = batch.data;
    setInfo({ code: b.code, production_date: b.production_date, notes: b.notes ?? '' });
    setRows(b.materials.map((m) => ({ material_id: m.material.id, quantity: m.quantity })));
    setItems(null);
  }, [batch.data]);

  const recalculate = useMutation({
    mutationFn: () =>
      api.post<BatchPreview>('/batches/preview', {
        items: items ? toItemInputs(items) : toItemInputs(toRows(batch.data!.items)),
      }),
    onSuccess: (p) => setRows(p.lines.map((l) => ({ material_id: l.material.id, quantity: l.quantity }))),
    onError: notifyError,
  });

  const invalidate = () => {
    for (const key of ['batches', 'materials', 'products', 'dashboard']) queryClient.invalidateQueries({ queryKey: [key] });
  };

  const save = useMutation({
    mutationFn: () => {
      const b = batch.data!;
      const body: Record<string, unknown> = { code: info.code, production_date: info.production_date, notes: info.notes || null };
      if (items) body.items = toItemInputs(items);
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
  const editableMaterials = !b.materials_consumed;
  const editableItems = b.status === 'planificado' && !b.materials_consumed;

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
        subtitle={`${date(b.production_date)} · ${b.items.length} producto${b.items.length === 1 ? '' : 's'} · ${b.planned_quantity} unidades`}
        actions={actions}
      />

      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack>
            <Card withBorder>
              <Table>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>Unidades planificadas</Table.Td>
                    <Table.Td ta="right">{b.planned_quantity}</Table.Td>
                  </Table.Tr>
                  {b.status === 'terminado' && (
                    <Table.Tr>
                      <Table.Td>Unidades buenas</Table.Td>
                      <Table.Td ta="right">{b.good_quantity}</Table.Td>
                    </Table.Tr>
                  )}
                  <Table.Tr>
                    <Table.Td>Costo total de materiales</Table.Td>
                    <Table.Td ta="right" fw={700}>
                      {money(b.total_cost)}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              <Divider my="sm" />
              <ProfitSummary
                revenue={b.expected_revenue}
                profit={b.expected_profit}
                revenueMin={b.expected_revenue_min}
                revenueMax={b.expected_revenue_max}
                profitMin={b.expected_profit_min}
                profitMax={b.expected_profit_max}
                withoutPrice={b.items_without_price}
                finished={b.status === 'terminado'}
              />
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
                <Textarea label="Notas" value={info.notes} onChange={(e) => setInfo({ ...info, notes: e.currentTarget.value })} autosize minRows={2} />
                <Button onClick={() => save.mutate()} loading={save.isPending}>
                  Guardar cambios
                </Button>
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack>
            <Card withBorder>
              <Group justify="space-between" mb="xs">
                <Title order={5}>Productos del lote</Title>
                {editableItems && !items && (
                  <Button size="xs" variant="light" onClick={() => setItems(toRows(b.items))}>
                    Editar productos
                  </Button>
                )}
                {items && (
                  <Button size="xs" variant="subtle" color="gray" onClick={() => setItems(null)}>
                    Descartar cambios
                  </Button>
                )}
              </Group>
              {items ? (
                <>
                  <BatchItemsEditor rows={items} onChange={setItems} products={products.data?.items ?? []} mixtures={mixtures.data ?? []} />
                  <Text size="xs" c="dimmed" mt="xs">
                    Al cambiar productos, usa «Recalcular desde las recetas» en la materia prima y luego «Guardar cambios».
                  </Text>
                </>
              ) : (
                <ItemsTable batch={b} onOpen={(id) => navigate(`/productos/${id}`)} />
              )}
            </Card>
            <Card withBorder>
              <Group justify="space-between" mb="xs">
                <Title order={5}>Materia prima del lote</Title>
                {editableMaterials && (
                  <Button size="xs" variant="subtle" onClick={() => recalculate.mutate()} loading={recalculate.isPending}>
                    Recalcular desde las recetas
                  </Button>
                )}
              </Group>
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
          </Stack>
        </Grid.Col>
      </Grid>

      <FinishModal
        opened={finishing}
        items={b.items}
        loading={changeStatus.isPending}
        onClose={() => setFinishing(false)}
        onConfirm={(results) => changeStatus.mutate({ status: 'terminado', results })}
      />
    </>
  );
}

function ItemsTable({ batch, onOpen }: { batch: BatchDetail; onOpen: (productId: number) => void }) {
  const done = batch.status === 'terminado';
  return (
    <Table.ScrollContainer minWidth={640}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Producto</Table.Th>
            <Table.Th ta="right">Planif.</Table.Th>
            {done && <Table.Th ta="right">Prod.</Table.Th>}
            {done && <Table.Th ta="right">Def.</Table.Th>}
            <Table.Th ta="right">Costo asignado</Table.Th>
            <Table.Th ta="right">Costo c/u</Table.Th>
            <Table.Th ta="right">Margen</Table.Th>
            <Table.Th ta="right">Ganancia</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {batch.items.map((i) => {
            const price = i.product.reference_price;
            return (
              <Table.Tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(i.product.id)}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <ProductThumb url={i.product.thumb_url} type={i.product.type} size={32} />
                    <div>
                      <Text size="sm" fw={600}>
                        {i.product.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {i.product.code}
                      </Text>
                    </div>
                  </Group>
                </Table.Td>
                <Table.Td ta="right">{i.planned_quantity}</Table.Td>
                {done && <Table.Td ta="right">{i.produced_quantity ?? '—'}</Table.Td>}
                {done && <Table.Td ta="right">{i.defective_quantity}</Table.Td>}
                <Table.Td ta="right">{money(i.allocated_cost)}</Table.Td>
                <Table.Td ta="right" fw={600}>
                  {money(i.unit_cost)}
                </Table.Td>
                <Table.Td ta="right">{price && i.unit_cost !== null ? percent((price - i.unit_cost) / price) : '—'}</Table.Td>
                <Table.Td ta="right" c={i.expected_profit === null ? undefined : i.expected_profit >= 0 ? 'teal' : 'red'}>
                  {i.expected_profit === null ? 'Sin precio' : money(i.expected_profit)}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function FinishModal(props: {
  opened: boolean;
  items: BatchItem[];
  loading: boolean;
  onClose: () => void;
  onConfirm: (results: ItemResult[]) => void;
}) {
  const [results, setResults] = useState<ItemResult[]>([]);

  useEffect(() => {
    if (props.opened) {
      setResults(
        props.items.map((i) => ({
          item_id: i.id,
          produced_quantity: i.produced_quantity ?? i.planned_quantity,
          defective_quantity: i.defective_quantity,
        })),
      );
    }
  }, [props.opened, props.items]);

  const set = (id: number, change: Partial<ItemResult>) =>
    setResults((rs) => rs.map((r) => (r.item_id === id ? { ...r, ...change } : r)));
  const good = results.reduce((s, r) => s + Math.max(r.produced_quantity - r.defective_quantity, 0), 0);

  return (
    <Modal opened={props.opened} onClose={props.onClose} title="Terminar lote" size="lg">
      <Stack>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Producto</Table.Th>
              <Table.Th w={120}>Producidas</Table.Th>
              <Table.Th w={120}>Defectuosas</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {props.items.map((i) => {
              const r = results.find((x) => x.item_id === i.id);
              if (!r) return null;
              return (
                <Table.Tr key={i.id}>
                  <Table.Td>
                    {i.product.name}
                    <Text size="xs" c="dimmed">
                      Planificadas: {i.planned_quantity}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      value={r.produced_quantity}
                      onChange={(v) => set(i.id, { produced_quantity: Number(v) || 0 })}
                      min={0}
                      allowDecimal={false}
                      aria-label={`Producidas de ${i.product.name}`}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      value={r.defective_quantity}
                      onChange={(v) => set(i.id, { defective_quantity: Number(v) || 0 })}
                      min={0}
                      max={r.produced_quantity}
                      allowDecimal={false}
                      aria-label={`Defectuosas de ${i.product.name}`}
                    />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        <Text size="sm">
          Se sumarán <b>{good}</b> unidades buenas al stock de los productos. Si los materiales no se habían descontado, se descontarán ahora.
        </Text>
        <Button color="teal" onClick={() => props.onConfirm(results)} loading={props.loading}>
          Terminar
        </Button>
      </Stack>
    </Modal>
  );
}
