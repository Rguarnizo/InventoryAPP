import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Material, Mixture, MixtureInput, MixtureType, Page } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { MIXTURE_TYPES, money, num, toOptions } from '../lib/format';
import { notifyError, notifyOk } from '../lib/notify';

export function MixturesPage() {
  const [editing, setEditing] = useState<Mixture | 'new' | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['mixtures'], queryFn: () => api.get<Mixture[]>('/mixtures') });

  return (
    <>
      <PageHeader
        title="Mezclas"
        subtitle="Fórmulas reutilizables (concreto, ceras…) definidas por proporción de cada material. Las recetas de productos usan su peso en gramos."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Nueva mezcla
          </Button>
        }
      />
      {isLoading && <Loader />}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {data?.map((m) => {
          const total = m.components.reduce((s, c) => s + c.proportion, 0);
          return (
            <Card key={m.id} withBorder style={{ cursor: 'pointer' }} onClick={() => setEditing(m)}>
              <Group justify="space-between" mb="xs">
                <Text fw={700}>{m.name}</Text>
                <Badge variant="light" color={m.type === 'cera' ? 'orange' : m.type === 'concreto' ? 'gray' : 'grape'}>
                  {MIXTURE_TYPES[m.type]}
                </Badge>
              </Group>
              <Table fz="sm">
                <Table.Tbody>
                  {m.components.map((c) => (
                    <Table.Tr key={c.id}>
                      <Table.Td>{c.material.name}</Table.Td>
                      <Table.Td ta="right">{num(c.proportion, 2)}</Table.Td>
                      <Table.Td ta="right" c="dimmed">
                        {num((c.proportion / total) * 100, 1)} %
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              <Text size="sm" mt="sm">
                <b>{money(m.cost_per_unit, 3)}</b> por g · {money(m.cost_per_unit * 1000)} por kg
              </Text>
              {m.notes && (
                <Text size="xs" c="dimmed" mt={4}>
                  {m.notes}
                </Text>
              )}
            </Card>
          );
        })}
      </SimpleGrid>
      {editing && <MixtureModal mixture={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function MixtureModal({ mixture, onClose }: { mixture: Mixture | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const materials = useQuery({
    queryKey: ['materials', 'all'],
    queryFn: () => api.get<Page<Material>>('/materials', { size: 500 }),
  });
  const [form, setForm] = useState<MixtureInput>(
    mixture
      ? {
          name: mixture.name,
          type: mixture.type,
          notes: mixture.notes,
          components: mixture.components.map((c) => ({ material_id: c.material.id, proportion: c.proportion })),
        }
      : { name: '', type: 'otro', notes: null, components: [] },
  );

  const invalidate = () => {
    for (const key of ['mixtures', 'products']) queryClient.invalidateQueries({ queryKey: [key] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, components: form.components.filter((c) => c.material_id && c.proportion > 0) };
      return mixture ? api.put(`/mixtures/${mixture.id}`, body) : api.post('/mixtures', body);
    },
    onSuccess: () => {
      invalidate();
      notifyOk('Mezcla guardada');
      onClose();
    },
    onError: notifyError,
  });

  const remove = () =>
    modals.openConfirmModal({
      title: 'Eliminar mezcla',
      children: <Text size="sm">¿Eliminar «{mixture!.name}»?</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        api
          .delete(`/mixtures/${mixture!.id}`)
          .then(() => {
            invalidate();
            onClose();
          })
          .catch(notifyError),
    });

  const mats = materials.data?.items ?? [];
  const total = form.components.reduce((s, c) => s + (c.proportion || 0), 0);
  const costPerGram = total
    ? form.components.reduce((s, c) => s + (c.proportion || 0) * (mats.find((m) => m.id === c.material_id)?.unit_cost ?? 0), 0) / total
    : 0;

  const setComponent = (i: number, change: Partial<MixtureInput['components'][number]>) =>
    setForm((f) => ({ ...f, components: f.components.map((c, j) => (j === i ? { ...c, ...change } : c)) }));

  return (
    <Modal opened onClose={onClose} title={mixture ? mixture.name : 'Nueva mezcla'} size="lg">
      <Stack>
        <Group grow>
          <TextInput label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} required />
          <Select
            label="Tipo"
            data={toOptions(MIXTURE_TYPES)}
            value={form.type}
            onChange={(v) => v && setForm({ ...form, type: v as MixtureType })}
            allowDeselect={false}
          />
        </Group>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Material</Table.Th>
              <Table.Th w={130}>Proporción</Table.Th>
              <Table.Th w={70} ta="right">
                %
              </Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {form.components.map((c, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <Select
                    data={mats.map((m) => ({ value: String(m.id), label: m.name }))}
                    value={c.material_id ? String(c.material_id) : null}
                    onChange={(v) => setComponent(i, { material_id: Number(v) })}
                    searchable
                    aria-label="Material"
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    value={c.proportion}
                    onChange={(v) => setComponent(i, { proportion: Number(v) || 0 })}
                    min={0}
                    decimalScale={3}
                    aria-label="Proporción"
                  />
                </Table.Td>
                <Table.Td ta="right">{total ? num((c.proportion / total) * 100, 1) : 0}</Table.Td>
                <Table.Td>
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    onClick={() => setForm((f) => ({ ...f, components: f.components.filter((_, j) => j !== i) }))}
                    aria-label="Quitar"
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group justify="space-between">
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => setForm((f) => ({ ...f, components: [...f.components, { material_id: 0, proportion: 1 }] }))}
          >
            Agregar material
          </Button>
          <Text size="sm">
            Costo: <b>{money(costPerGram, 3)}</b>/g · {money(costPerGram * 1000)}/kg
          </Text>
        </Group>
        <Textarea label="Notas" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value || null })} autosize />
        <Group justify="space-between">
          {mixture ? (
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
