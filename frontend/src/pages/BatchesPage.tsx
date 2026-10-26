import { Button, Card, Group, Select, Text, TextInput, Tooltip } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import type { Batch, Page, Product } from '../api/types';
import { Column, DataTable } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { BatchProducts } from '../components/BatchProducts';
import { StatusBadge } from '../components/StatusBadge';
import { BATCH_STATUS, date, money } from '../lib/format';
import { useListState } from '../lib/useListState';

const columns: Column<Batch>[] = [
  { key: 'code', header: 'Lote', sortable: true, render: (b) => <Text size="sm" fw={600} ff="monospace" style={{ whiteSpace: 'nowrap' }}>{b.code}</Text> },
  { key: 'production_date', header: 'Fecha', sortable: true, render: (b) => <Text size="sm" style={{ whiteSpace: 'nowrap' }}>{date(b.production_date)}</Text> },
  { key: 'items', header: 'Productos', sortable: true, render: (b) => <BatchProducts items={b.items} /> },
  { key: 'planned_quantity', header: 'Unidades', sortable: true, align: 'right', render: (b) => b.planned_quantity },
  {
    key: 'good_quantity',
    header: 'Buenas',
    sortable: true,
    align: 'right',
    render: (b) => (b.status === 'terminado' ? b.good_quantity : '—'),
  },
  { key: 'total_cost', header: 'Costo total', sortable: true, align: 'right', render: (b) => money(b.total_cost) },
  { key: 'expected_revenue', header: 'Venta total', sortable: true, align: 'right', hidden: true, render: (b) => money(b.expected_revenue) },
  {
    key: 'expected_profit',
    header: 'Ganancia est.',
    sortable: true,
    align: 'right',
    render: (b) => (
      <Tooltip label="Hay productos sin precio; no suman a la venta" disabled={b.items_without_price === 0}>
        <Text size="sm" fw={600} c={b.expected_profit >= 0 ? 'teal' : 'red'} style={{ whiteSpace: 'nowrap' }}>
          {money(b.expected_profit)}
          {b.items_without_price > 0 && ' *'}
        </Text>
      </Tooltip>
    ),
  },
  { key: 'status', header: 'Estado', sortable: true, render: (b) => <StatusBadge status={b.status} /> },
]

export function BatchesPage() {
  const navigate = useNavigate();
  const list = useListState({ sort: 'production_date', order: 'desc' });
  const { data, isFetching } = useQuery({
    queryKey: ['batches', list.query],
    queryFn: () => api.get<Page<Batch>>('/batches', list.query),
    placeholderData: keepPreviousData,
  });
  const products = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api.get<Page<Product>>('/products', { size: 500, sort: 'name' }),
  });

  return (
    <>
      <PageHeader
        title="Lotes de producción"
        subtitle="Cada lote descuenta la materia prima al iniciarse y suma unidades al stock al terminarse."
        actions={
          <>
            <Button variant="default" onClick={() => api.download('/export/batches', 'lotes.csv')}>
              Exportar CSV
            </Button>
            <Button component={Link} to="/lotes/nuevo" leftSection={<IconPlus size={16} />}>
              Nuevo lote
            </Button>
          </>
        }
      />
      <Card withBorder>
        <Group mb="md" gap="sm" wrap="wrap">
          <TextInput
            placeholder="Buscar por código, producto o notas…"
            defaultValue={list.filter('q')}
            onChange={(e) => list.setFilter('q', e.currentTarget.value)}
            style={{ flex: '1 1 220px' }}
          />
          <Select
            placeholder="Estado"
            data={Object.entries(BATCH_STATUS).map(([value, { label }]) => ({ value, label }))}
            value={list.filter('status') || null}
            onChange={(v) => list.setFilter('status', v)}
            clearable
            w={160}
          />
          <Select
            placeholder="Producto"
            data={(products.data?.items ?? []).map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))}
            value={list.filter('product_id') || null}
            onChange={(v) => list.setFilter('product_id', v)}
            searchable
            clearable
            w={240}
          />
          <TextInput type="date" aria-label="Desde" value={list.filter('date_from')} onChange={(e) => list.setFilter('date_from', e.currentTarget.value)} w={150} />
          <TextInput type="date" aria-label="Hasta" value={list.filter('date_to')} onChange={(e) => list.setFilter('date_to', e.currentTarget.value)} w={150} />
        </Group>
        <DataTable
          storageKey="batches"
          columns={columns}
          rows={data?.items}
          rowKey={(b) => b.id}
          loading={isFetching}
          sort={list.sort}
          order={list.order}
          onSort={list.setSort}
          page={list.page}
          size={list.size}
          total={data?.total}
          onPage={list.setPage}
          onSize={list.setSize}
          onRowClick={(b) => navigate(`/lotes/${b.id}`)}
          empty="Aún no hay lotes registrados"
        />
      </Card>
    </>
  );
}
