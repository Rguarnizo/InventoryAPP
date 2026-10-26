import { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import type { Page, Product } from '../api/types';
import { CsvButtons } from '../components/CsvButtons';
import { Column, DataTable } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { ProductThumb } from '../components/ProductThumb';
import { money, num, percent, PRODUCT_TYPES, toOptions } from '../lib/format';
import { useListState } from '../lib/useListState';

function marginColor(m: number | null) {
  if (m === null) return 'gray';
  if (m < 0.3) return 'red';
  if (m < 0.6) return 'yellow';
  return 'teal';
}

const columns: Column<Product>[] = [
  { key: 'photo', header: 'Foto', render: (p) => <ProductThumb url={p.thumb_url} type={p.type} />, width: 56 },
  { key: 'code', header: 'Código', sortable: true, render: (p) => <Text size="sm" ff="monospace">{p.code}</Text> },
  {
    key: 'name',
    header: 'Referencia',
    sortable: true,
    render: (p) => (
      <Stack gap={0}>
        <Text size="sm" fw={600}>
          {p.name}
        </Text>
        {!p.active && (
          <Text size="xs" c="dimmed">
            Inactivo
          </Text>
        )}
      </Stack>
    ),
  },
  { key: 'type', header: 'Tipo', sortable: true, render: (p) => <Badge variant="light" color={p.type === 'vela' ? 'orange' : 'gray'} styles={{ root: { overflow: 'visible' }, label: { overflow: 'visible' } }}>{PRODUCT_TYPES[p.type]}</Badge> },
  { key: 'category', header: 'Categoría', sortable: true, render: (p) => p.category ?? '—' },
  { key: 'can_be_candle', header: '¿Puede ser vela?', hidden: true, render: (p) => (p.can_be_candle ? 'Sí' : 'No') },
  { key: 'water_weight_ml', header: 'Peso agua (ml)', sortable: true, hidden: true, align: 'right', render: (p) => num(p.water_weight_ml) },
  { key: 'weight_g', header: 'Peso (g)', sortable: true, align: 'right', render: (p) => num(p.weight_g) },
  { key: 'estimated_cost', header: 'Costo', sortable: true, align: 'right', render: (p) => money(p.estimated_cost) },
  { key: 'min_price', header: 'Precio mín.', sortable: true, align: 'right', render: (p) => money(p.min_price) },
  { key: 'max_price', header: 'Precio máx.', sortable: true, align: 'right', render: (p) => money(p.max_price) },
  { key: 'sale_price', header: 'Precio venta', sortable: true, align: 'right', hidden: true, render: (p) => money(p.sale_price) },
  {
    key: 'margin',
    header: 'Margen',
    sortable: true,
    align: 'right',
    render: (p) => <Badge variant="light" color={marginColor(p.margin)}>{percent(p.margin)}</Badge>,
  },
  { key: 'mold_price', header: 'Precio molde', sortable: true, align: 'right', render: (p) => money(p.mold_price) },
  { key: 'stock', header: 'Stock', sortable: true, align: 'right', render: (p) => <Text size="sm" fw={p.stock > 0 ? 700 : 400} c={p.stock > 0 ? undefined : 'dimmed'}>{p.stock}</Text> },
];

export function ProductsPage() {
  const navigate = useNavigate();
  const list = useListState({ sort: 'code', order: 'asc' });
  const [search, setSearch] = useState(list.filter('q'));
  const [debounced] = useDebouncedValue(search, 300);

  useEffect(() => {
    if (debounced !== list.filter('q')) list.setFilter('q', debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isFetching } = useQuery({
    queryKey: ['products', list.query],
    queryFn: () => api.get<Page<Product>>('/products', list.query),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({ queryKey: ['products', 'categories'], queryFn: () => api.get<string[]>('/products/categories') });

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle="Figuras de concreto, velas y demás referencias. Haz clic en una columna para ordenar."
        actions={
          <>
            <CsvButtons entity="products" filename="productos.csv" invalidate={['products', 'dashboard']} />
            <Button component={Link} to="/productos/nuevo" leftSection={<IconPlus size={16} />}>
              Nuevo producto
            </Button>
          </>
        }
      />
      <Card withBorder>
        <Group mb="md" gap="sm" wrap="wrap">
          <TextInput
            placeholder="Buscar por nombre, código, categoría…"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: '1 1 240px' }}
          />
          <Select
            placeholder="Tipo"
            data={toOptions(PRODUCT_TYPES)}
            value={list.filter('type') || null}
            onChange={(v) => list.setFilter('type', v)}
            clearable
            w={180}
          />
          <Select
            placeholder="Categoría"
            data={categories.data ?? []}
            value={list.filter('category') || null}
            onChange={(v) => list.setFilter('category', v)}
            clearable
            w={160}
          />
          <SegmentedControl
            size="xs"
            value={list.filter('active') || 'all'}
            onChange={(v) => list.setFilter('active', v === 'all' ? null : v)}
            data={[
              { value: 'all', label: 'Todos' },
              { value: 'true', label: 'Activos' },
              { value: 'false', label: 'Inactivos' },
            ]}
          />
        </Group>
        <DataTable
          storageKey="products"
          columns={columns}
          rows={data?.items}
          rowKey={(p) => p.id}
          loading={isFetching}
          sort={list.sort}
          order={list.order}
          onSort={list.setSort}
          page={list.page}
          size={list.size}
          total={data?.total}
          onPage={list.setPage}
          onSize={list.setSize}
          onRowClick={(p) => navigate(`/productos/${p.id}`)}
          rowStyle={(p) => (p.active ? undefined : { opacity: 0.55 })}
        />
      </Card>
    </>
  );
}
