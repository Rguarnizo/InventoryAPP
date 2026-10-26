import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconPlus, IconShoppingCart } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Material, MaterialInput, Movement, Page, Unit } from '../api/types';
import { CsvButtons } from '../components/CsvButtons';
import { Column, DataTable } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { dateTime, money, MOVEMENT_TYPES, qty, toOptions, UNITS } from '../lib/format';
import { notifyError, notifyOk } from '../lib/notify';
import { useListState } from '../lib/useListState';

const EMPTY: MaterialInput = {
  name: '',
  unit: 'g',
  package_quantity: 1000,
  package_price: 0,
  stock: 0,
  min_stock: 0,
  supplier: null,
  notes: null,
};

const unitCostDecimals = (u: Unit) => (u === 'unidad' ? 0 : 2);

export function MaterialsPage() {
  const list = useListState({ sort: 'name', order: 'asc', size: 50 });
  const [editing, setEditing] = useState<Material | 'new' | null>(null);
  const [buying, setBuying] = useState<Material | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ['materials', list.query],
    queryFn: () => api.get<Page<Material>>('/materials', list.query),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Material>[] = [
    { key: 'name', header: 'Material', sortable: true, render: (m) => <Text size="sm" fw={600}>{m.name}</Text> },
    { key: 'unit', header: 'Unidad', sortable: true, render: (m) => m.unit },
    {
      key: 'package_quantity',
      header: 'Presentación',
      sortable: true,
      align: 'right',
      render: (m) => qty(m.package_quantity, m.unit),
    },
    { key: 'package_price', header: 'Valor presentación', sortable: true, align: 'right', render: (m) => money(m.package_price) },
    {
      key: 'unit_cost',
      header: 'Costo por unidad',
      sortable: true,
      align: 'right',
      render: (m) => `${money(m.unit_cost, unitCostDecimals(m.unit))} / ${m.unit === 'unidad' ? 'u' : m.unit}`,
    },
    {
      key: 'stock',
      header: 'Stock',
      sortable: true,
      align: 'right',
      render: (m) => (
        <Group gap={6} justify="flex-end" wrap="nowrap">
          {m.low_stock && <Badge color="orange" size="xs">Bajo</Badge>}
          <Text size="sm" c={m.stock < 0 ? 'red' : undefined}>
            {qty(m.stock, m.unit)}
          </Text>
        </Group>
      ),
    },
    { key: 'min_stock', header: 'Mínimo', sortable: true, align: 'right', render: (m) => qty(m.min_stock, m.unit) },
    { key: 'supplier', header: 'Proveedor', sortable: true, hidden: true, render: (m) => m.supplier ?? '—' },
    {
      key: 'actions',
      header: '',
      render: (m) => (
        <Tooltip label="Registrar compra o ajuste">
          <ActionIcon
            variant="light"
            onClick={(e) => {
              e.stopPropagation();
              setBuying(m);
            }}
            aria-label="Registrar compra"
          >
            <IconShoppingCart size={16} />
          </ActionIcon>
        </Tooltip>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Materia prima"
        subtitle="Insumos con su presentación de compra. El costo por gramo/unidad se usa para costear productos y lotes."
        actions={
          <>
            <CsvButtons entity="materials" filename="materia_prima.csv" invalidate={['materials', 'mixtures', 'products']} />
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              Nuevo material
            </Button>
          </>
        }
      />
      <Card withBorder>
        <Group mb="md">
          <TextInput
            placeholder="Buscar material o proveedor…"
            defaultValue={list.filter('q')}
            onChange={(e) => list.setFilter('q', e.currentTarget.value)}
            style={{ flex: '1 1 240px' }}
          />
          <SegmentedControl
            size="xs"
            value={list.filter('low_stock') || 'all'}
            onChange={(v) => list.setFilter('low_stock', v === 'all' ? null : v)}
            data={[
              { value: 'all', label: 'Todos' },
              { value: 'true', label: 'Bajo mínimo' },
            ]}
          />
        </Group>
        <DataTable
          storageKey="materials"
          columns={columns}
          rows={data?.items}
          rowKey={(m) => m.id}
          loading={isFetching}
          sort={list.sort}
          order={list.order}
          onSort={list.setSort}
          page={list.page}
          size={list.size}
          total={data?.total}
          onPage={list.setPage}
          onSize={list.setSize}
          onRowClick={setEditing}
        />
      </Card>
      {editing && <MaterialModal material={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {buying && <AdjustModal material={buying} onClose={() => setBuying(null)} />}
    </>
  );
}

function useInvalidateMaterials() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['materials', 'mixtures', 'products', 'dashboard']) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

function MaterialModal({ material, onClose }: { material: Material | null; onClose: () => void }) {
  const [form, setForm] = useState<MaterialInput>(material ?? EMPTY);
  const invalidate = useInvalidateMaterials();
  const set = <K extends keyof MaterialInput>(k: K, v: MaterialInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const movements = useQuery({
    queryKey: ['materials', material?.id, 'movements'],
    queryFn: () => api.get<Movement[]>(`/materials/${material!.id}/movements`, { limit: 20 }),
    enabled: !!material,
  });

  const save = useMutation({
    mutationFn: () => (material ? api.put(`/materials/${material.id}`, form) : api.post('/materials', form)),
    onSuccess: () => {
      invalidate();
      notifyOk('Material guardado');
      onClose();
    },
    onError: notifyError,
  });

  const remove = () =>
    modals.openConfirmModal({
      title: 'Eliminar material',
      children: <Text size="sm">¿Eliminar «{material!.name}»?</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        api
          .delete(`/materials/${material!.id}`)
          .then(() => {
            invalidate();
            onClose();
          })
          .catch(notifyError),
    });

  const unitCost = form.package_quantity ? form.package_price / form.package_quantity : 0;

  return (
    <Modal opened onClose={onClose} title={material ? material.name : 'Nuevo material'} size="lg">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nombre" value={form.name} onChange={(e) => set('name', e.currentTarget.value)} required />
          <Select
            label="Unidad base"
            data={toOptions(UNITS)}
            value={form.unit}
            onChange={(v) => v && set('unit', v as Unit)}
            allowDeselect={false}
          />
          <NumberInput
            label={`Presentación (${form.unit})`}
            description={form.unit === 'g' ? 'Ej. bulto de 25 kg = 25000' : undefined}
            value={form.package_quantity}
            onChange={(v) => set('package_quantity', Number(v) || 0)}
            min={0}
            thousandSeparator="."
            decimalSeparator=","
          />
          <NumberInput
            label="Valor de la presentación"
            value={form.package_price}
            onChange={(v) => set('package_price', Number(v) || 0)}
            min={0}
            prefix="$ "
            thousandSeparator="."
            decimalSeparator=","
          />
          {!material && (
            <NumberInput
              label={`Stock inicial (${form.unit})`}
              value={form.stock}
              onChange={(v) => set('stock', Number(v) || 0)}
              min={0}
              thousandSeparator="."
              decimalSeparator=","
            />
          )}
          <NumberInput
            label={`Stock mínimo (${form.unit})`}
            description="Avisa cuando el stock baja de este valor"
            value={form.min_stock}
            onChange={(v) => set('min_stock', Number(v) || 0)}
            min={0}
            thousandSeparator="."
            decimalSeparator=","
          />
          <TextInput label="Proveedor" value={form.supplier ?? ''} onChange={(e) => set('supplier', e.currentTarget.value || null)} />
        </SimpleGrid>
        <Textarea label="Notas" value={form.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value || null)} autosize />
        <Text size="sm">
          Costo por {form.unit === 'unidad' ? 'unidad' : form.unit}: <b>{money(unitCost, unitCostDecimals(form.unit))}</b>
          {form.unit === 'g' && <> · por kg: <b>{money(unitCost * 1000)}</b></>}
        </Text>

        {material && movements.data && movements.data.length > 0 && (
          <>
            <Text fw={600} size="sm">
              Últimos movimientos
            </Text>
            <Table fz="xs">
              <Table.Tbody>
                {movements.data.map((mv) => (
                  <Table.Tr key={mv.id}>
                    <Table.Td>{dateTime(mv.created_at)}</Table.Td>
                    <Table.Td>{MOVEMENT_TYPES[mv.type]}</Table.Td>
                    <Table.Td ta="right" c={mv.quantity < 0 ? 'red' : 'teal'}>
                      {mv.quantity > 0 ? '+' : ''}
                      {qty(mv.quantity, material.unit)}
                    </Table.Td>
                    <Table.Td>{mv.note}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </>
        )}

        <Group justify="space-between">
          {material ? (
            <Button variant="subtle" color="red" onClick={remove}>
              Eliminar
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function AdjustModal({ material, onClose }: { material: Material; onClose: () => void }) {
  const [type, setType] = useState<'compra' | 'ajuste'>('compra');
  const [packages, setPackages] = useState<number>(1);
  const [quantity, setQuantity] = useState<number>(material.package_quantity);
  const [price, setPrice] = useState<number>(material.package_price);
  const [note, setNote] = useState('');
  const invalidate = useInvalidateMaterials();

  useEffect(() => {
    if (type === 'compra') setQuantity(packages * material.package_quantity);
  }, [packages, type, material.package_quantity]);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/materials/${material.id}/adjust`, {
        type,
        quantity,
        note: note || null,
        package_price: type === 'compra' && price !== material.package_price ? price : null,
      }),
    onSuccess: () => {
      invalidate();
      notifyOk(type === 'compra' ? 'Compra registrada' : 'Ajuste registrado');
      onClose();
    },
    onError: notifyError,
  });

  return (
    <Modal opened onClose={onClose} title={`${material.name} · stock actual ${qty(material.stock, material.unit)}`}>
      <Stack>
        <SegmentedControl
          value={type}
          onChange={(v) => setType(v as 'compra' | 'ajuste')}
          data={[
            { value: 'compra', label: 'Compra' },
            { value: 'ajuste', label: 'Ajuste / conteo' },
          ]}
        />
        {type === 'compra' && (
          <NumberInput
            label={`Presentaciones compradas (${qty(material.package_quantity, material.unit)} c/u)`}
            value={packages}
            onChange={(v) => setPackages(Number(v) || 0)}
            min={0}
          />
        )}
        <NumberInput
          label={type === 'compra' ? `Cantidad total (${material.unit})` : `Cantidad a sumar o restar (${material.unit})`}
          description={type === 'ajuste' ? 'Usa un valor negativo para restar (mermas, pérdidas…)' : undefined}
          value={quantity}
          onChange={(v) => setQuantity(Number(v) || 0)}
          thousandSeparator="."
          decimalSeparator=","
        />
        {type === 'compra' && (
          <NumberInput
            label="Precio pagado por presentación"
            description="Si cambió, se actualiza el costo del material"
            value={price}
            onChange={(v) => setPrice(Number(v) || 0)}
            prefix="$ "
            thousandSeparator="."
            decimalSeparator=","
            min={0}
          />
        )}
        <TextInput label="Nota" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Text size="sm">
          Nuevo stock: <b>{qty(material.stock + quantity, material.unit)}</b>
        </Text>
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!quantity}>
          Guardar
        </Button>
      </Stack>
    </Modal>
  );
}
