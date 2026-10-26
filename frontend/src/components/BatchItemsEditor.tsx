import { ActionIcon, Button, Group, NumberInput, Select, Stack, Table, Text } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueries } from '@tanstack/react-query';
import { api } from '../api/client';
import type { BatchItemInput, Mixture, Product, ProductDetail } from '../api/types';
import { money, num } from '../lib/format';

export interface BatchItemRow {
  key: string;
  product_id: number | null;
  planned_quantity: number;
  mixture_overrides: Record<number, number>;
}

let counter = 0;
export const newItemRow = (product_id: number | null = null, planned_quantity = 1): BatchItemRow => ({
  key: `item-${++counter}`,
  product_id,
  planned_quantity,
  mixture_overrides: {},
});

/** Filas completas listas para enviar a la API. */
export const toItemInputs = (rows: BatchItemRow[]): BatchItemInput[] =>
  rows
    .filter((r) => r.product_id && r.planned_quantity > 0)
    .map((r) => ({ product_id: r.product_id!, planned_quantity: r.planned_quantity, mixture_overrides: r.mixture_overrides }));

interface Props {
  rows: BatchItemRow[];
  onChange: (rows: BatchItemRow[]) => void;
  products: Product[];
  mixtures: Mixture[];
  /** Costo unitario estimado por fila (mismo orden que las filas completas), de la vista previa */
  estimatedCosts?: number[];
}

/** Productos de un lote: producto, unidades y, si aplica, la mezcla a usar (p.ej. otra cera). */
export function BatchItemsEditor({ rows, onChange, products, mixtures, estimatedCosts }: Props) {
  const details = useQueries({
    queries: rows.map((r) => ({
      queryKey: ['products', r.product_id],
      queryFn: () => api.get<ProductDetail>(`/products/${r.product_id}`),
      enabled: !!r.product_id,
    })),
  });

  const update = (key: string, change: Partial<BatchItemRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const options = products.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }));
  // La vista previa solo incluye filas completas; se asocian a su fila por posición
  const costByKey = new Map(
    rows.filter((r) => r.product_id && r.planned_quantity > 0).map((r, i) => [r.key, estimatedCosts?.[i]]),
  );

  return (
    <Stack gap="xs">
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Producto</Table.Th>
            <Table.Th w={110}>Unidades</Table.Th>
            <Table.Th ta="right" w={110}>
              Costo est. c/u
            </Table.Th>
            <Table.Th w={40} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r, i) => {
            const detail = details[i]?.data;
            const cost = costByKey.get(r.key);
            const mixtureComponents = (detail?.components ?? []).filter((c) => c.mixture);
            return (
              <Table.Tr key={r.key}>
                <Table.Td>
                  <Stack gap={6}>
                    <Select
                      data={options}
                      value={r.product_id ? String(r.product_id) : null}
                      onChange={(v) => update(r.key, { product_id: v ? Number(v) : null, mixture_overrides: {} })}
                      searchable
                      placeholder="Elegir producto…"
                      aria-label="Producto"
                    />
                    {detail && detail.components.length === 0 && (
                      <Text size="xs" c="orange">
                        Sin receta: agrega sus materiales abajo manualmente.
                      </Text>
                    )}
                    {mixtureComponents.map((c) => {
                      const alternatives = mixtures.filter((m) => m.type === c.mixture!.type);
                      if (alternatives.length < 2) return null;
                      return (
                        <Select
                          key={c.id}
                          size="xs"
                          leftSection={<Text size="xs" c="dimmed" pl={8}>{num(c.quantity)} g</Text>}
                          leftSectionWidth={60}
                          data={alternatives.map((m) => ({ value: String(m.id), label: m.name }))}
                          value={String(r.mixture_overrides[c.id] ?? c.mixture!.id)}
                          onChange={(v) =>
                            update(r.key, { mixture_overrides: { ...r.mixture_overrides, [c.id]: Number(v) } })
                          }
                          allowDeselect={false}
                          aria-label="Mezcla"
                        />
                      );
                    })}
                  </Stack>
                </Table.Td>
                <Table.Td style={{ verticalAlign: 'top' }}>
                  <NumberInput
                    value={r.planned_quantity}
                    onChange={(v) => update(r.key, { planned_quantity: Number(v) || 0 })}
                    min={1}
                    allowDecimal={false}
                    aria-label="Unidades"
                  />
                </Table.Td>
                <Table.Td ta="right" style={{ verticalAlign: 'top', paddingTop: 14 }}>
                  {cost !== undefined ? money(cost) : '—'}
                </Table.Td>
                <Table.Td style={{ verticalAlign: 'top' }}>
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    mt={4}
                    disabled={rows.length === 1}
                    onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                    aria-label="Quitar producto"
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => onChange([...rows, newItemRow()])}>
          Agregar producto
        </Button>
        <Text size="sm" c="dimmed">
          {rows.reduce((s, r) => s + (r.product_id ? r.planned_quantity : 0), 0)} unidades en total
        </Text>
      </Group>
    </Stack>
  );
}
