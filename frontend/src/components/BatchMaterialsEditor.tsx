import { ActionIcon, Badge, Button, Group, NumberInput, Select, Table, Text } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { Material } from '../api/types';
import { money, qty } from '../lib/format';

export interface BatchMaterialRow {
  material_id: number;
  quantity: number;
}

interface Props {
  rows: BatchMaterialRow[];
  onChange?: (rows: BatchMaterialRow[]) => void;
  materials: Material[];
  /** Costos congelados del lote (si ya se consumió), por material */
  frozenCosts?: Record<number, number>;
  showStock?: boolean;
}

export function BatchMaterialsEditor({ rows, onChange, materials, frozenCosts, showStock }: Props) {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const cost = (r: BatchMaterialRow) => r.quantity * (frozenCosts?.[r.material_id] ?? byId.get(r.material_id)?.unit_cost ?? 0);
  const total = rows.reduce((s, r) => s + cost(r), 0);
  const editable = !!onChange;

  const update = (i: number, change: Partial<BatchMaterialRow>) =>
    onChange?.(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));

  return (
    <>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Material</Table.Th>
            <Table.Th w={editable ? 170 : undefined} ta={editable ? undefined : 'right'}>
              Cantidad
            </Table.Th>
            {showStock && <Table.Th ta="right">Disponible</Table.Th>}
            <Table.Th ta="right">Costo</Table.Th>
            {editable && <Table.Th w={40} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r, i) => {
            const m = byId.get(r.material_id);
            const short = m && showStock && m.stock < r.quantity;
            return (
              <Table.Tr key={i}>
                <Table.Td>
                  {editable ? (
                    <Select
                      data={materials.map((x) => ({ value: String(x.id), label: x.name }))}
                      value={r.material_id ? String(r.material_id) : null}
                      onChange={(v) => update(i, { material_id: Number(v) })}
                      searchable
                      aria-label="Material"
                    />
                  ) : (
                    m?.name
                  )}
                </Table.Td>
                <Table.Td ta={editable ? undefined : 'right'}>
                  {editable ? (
                    <NumberInput
                      value={Math.round(r.quantity * 100) / 100}
                      onChange={(v) => update(i, { quantity: Number(v) || 0 })}
                      min={0}
                      decimalScale={2}
                      thousandSeparator="."
                      decimalSeparator=","
                      rightSection={<Text size="xs" c="dimmed">{m?.unit}</Text>}
                      aria-label="Cantidad"
                    />
                  ) : (
                    m && qty(r.quantity, m.unit)
                  )}
                </Table.Td>
                {showStock && (
                  <Table.Td ta="right">
                    {m && (
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        {short && <Badge color="red" size="xs">Falta</Badge>}
                        <Text size="sm" c={short ? 'red' : undefined}>
                          {qty(m.stock, m.unit)}
                        </Text>
                      </Group>
                    )}
                  </Table.Td>
                )}
                <Table.Td ta="right">{money(cost(r))}</Table.Td>
                {editable && (
                  <Table.Td>
                    <ActionIcon color="red" variant="subtle" onClick={() => onChange!(rows.filter((_, j) => j !== i))} aria-label="Quitar">
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                )}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <Group justify="space-between" mt="xs">
        {editable ? (
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => onChange!([...rows, { material_id: 0, quantity: 0 }])}
          >
            Agregar material (mecha, pegante…)
          </Button>
        ) : (
          <span />
        )}
        <Text fw={700}>Total materiales: {money(total)}</Text>
      </Group>
    </>
  );
}
