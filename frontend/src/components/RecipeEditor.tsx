import { ActionIcon, Button, Group, NumberInput, Select, Stack, Table, Text } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { Material, Mixture, ProductComponentInput } from '../api/types';
import { money } from '../lib/format';

export interface RecipeRow extends ProductComponentInput {
  key: string;
}

let counter = 0;
export const newRowKey = () => `row-${++counter}`;

interface Props {
  rows: RecipeRow[];
  onChange: (rows: RecipeRow[]) => void;
  materials: Material[];
  mixtures: Mixture[];
}

/** Editor de la receta de un producto: mezclas (por peso) y materiales sueltos (mechas, pegante…). */
export function RecipeEditor({ rows, onChange, materials, mixtures }: Props) {
  const options = [
    { group: 'Mezclas (peso por unidad en g)', items: mixtures.map((m) => ({ value: `mix:${m.id}`, label: m.name })) },
    { group: 'Materiales', items: materials.map((m) => ({ value: `mat:${m.id}`, label: `${m.name} (${m.unit})` })) },
  ];

  const sourceValue = (r: RecipeRow) =>
    r.mixture_id ? `mix:${r.mixture_id}` : r.material_id ? `mat:${r.material_id}` : null;

  const unitCost = (r: RecipeRow) => {
    if (r.mixture_id) return mixtures.find((m) => m.id === r.mixture_id)?.cost_per_unit ?? 0;
    if (r.material_id) return materials.find((m) => m.id === r.material_id)?.unit_cost ?? 0;
    return 0;
  };
  const unit = (r: RecipeRow) =>
    r.mixture_id ? 'g' : (materials.find((m) => m.id === r.material_id)?.unit ?? '');

  const update = (key: string, change: Partial<RecipeRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const setSource = (key: string, value: string | null) => {
    const [kind, id] = (value ?? ':').split(':');
    update(key, {
      mixture_id: kind === 'mix' ? Number(id) : null,
      material_id: kind === 'mat' ? Number(id) : null,
    });
  };

  const total = rows.reduce((sum, r) => sum + (r.quantity || 0) * unitCost(r), 0);

  return (
    <Stack gap="xs">
      {rows.length > 0 && (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Mezcla o material</Table.Th>
              <Table.Th w={160}>Cantidad por unidad</Table.Th>
              <Table.Th ta="right">Costo</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.key}>
                <Table.Td>
                  <Select
                    data={options}
                    value={sourceValue(r)}
                    onChange={(v) => setSource(r.key, v)}
                    searchable
                    placeholder="Elegir…"
                    aria-label="Mezcla o material"
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    value={r.quantity}
                    onChange={(v) => update(r.key, { quantity: Number(v) || 0 })}
                    min={0}
                    decimalScale={2}
                    rightSection={<Text size="xs" c="dimmed">{unit(r)}</Text>}
                    aria-label="Cantidad"
                  />
                </Table.Td>
                <Table.Td ta="right">{money((r.quantity || 0) * unitCost(r))}</Table.Td>
                <Table.Td>
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                    aria-label="Quitar"
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Group justify="space-between">
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => onChange([...rows, { key: newRowKey(), mixture_id: null, material_id: null, quantity: 0 }])}
        >
          Agregar componente
        </Button>
        <Text fw={600}>Costo estimado por unidad: {money(total)}</Text>
      </Group>
    </Stack>
  );
}
