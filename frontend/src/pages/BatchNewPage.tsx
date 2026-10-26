import { useEffect, useMemo, useState } from 'react';
import { Anchor, Button, Card, Grid, Group, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconArrowLeft } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { BatchDetail, BatchPreview, Material, Mixture, Page, Product } from '../api/types';
import { BatchItemRow, BatchItemsEditor, newItemRow, toItemInputs } from '../components/BatchItemsEditor';
import { BatchMaterialRow, BatchMaterialsEditor } from '../components/BatchMaterialsEditor';
import { PageHeader } from '../components/PageHeader';
import { ProfitSummary } from '../components/ProfitSummary';
import { money } from '../lib/format';
import { notifyError, notifyOk } from '../lib/notify';

const today = () => new Date().toLocaleDateString('en-CA');

export function BatchNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const initialProduct = params.get('product');
  const [items, setItems] = useState<BatchItemRow[]>(() => [newItemRow(initialProduct ? Number(initialProduct) : null, 10)]);
  const [productionDate, setProductionDate] = useState(today());
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<BatchMaterialRow[]>([]);
  const [touched, setTouched] = useState(false);
  const inputs = useMemo(() => toItemInputs(items), [items]);
  const [debouncedInputs] = useDebouncedValue(inputs, 300);

  const products = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api.get<Page<Product>>('/products', { size: 500, sort: 'name' }),
  });
  const mixtures = useQuery({ queryKey: ['mixtures'], queryFn: () => api.get<Mixture[]>('/mixtures') });
  const materials = useQuery({
    queryKey: ['materials', 'all'],
    queryFn: () => api.get<Page<Material>>('/materials', { size: 500 }),
  });
  const nextCode = useQuery({ queryKey: ['batches', 'next-code'], queryFn: () => api.get<string>('/batches/next-code') });

  const preview = useQuery({
    queryKey: ['batch-preview', debouncedInputs],
    queryFn: () => api.post<BatchPreview>('/batches/preview', { items: debouncedInputs }),
    enabled: debouncedInputs.length > 0,
    placeholderData: keepPreviousData,
  });

  // Los materiales se recalculan desde las recetas mientras el usuario no los edite a mano
  useEffect(() => {
    if (touched) return;
    if (!debouncedInputs.length) setRows([]);
    else if (preview.data) setRows(preview.data.lines.map((l) => ({ material_id: l.material.id, quantity: l.quantity })));
  }, [preview.data, touched, debouncedInputs.length]);

  const create = useMutation({
    mutationFn: () =>
      api.post<BatchDetail>('/batches', {
        items: inputs,
        production_date: productionDate || null,
        code: code || null,
        notes: notes || null,
        materials: rows.filter((r) => r.material_id && r.quantity > 0),
      }),
    onSuccess: (batch) => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      notifyOk(`Lote ${batch.code} creado`);
      navigate(`/lotes/${batch.id}`);
    },
    onError: notifyError,
  });

  const mats = materials.data?.items ?? [];
  const total = rows.reduce((s, r) => s + r.quantity * (mats.find((m) => m.id === r.material_id)?.unit_cost ?? 0), 0);

  // Venta estimada con los precios de cada producto (venta o mínimo; rango mín.–máx.)
  const productById = new Map((products.data?.items ?? []).map((p) => [p.id, p]));
  const revenue = { ref: 0, min: 0, max: 0, withoutPrice: 0 };
  for (const i of inputs) {
    const p = productById.get(i.product_id);
    const ref = p?.sale_price || p?.min_price;
    if (!ref) {
      revenue.withoutPrice += 1;
      continue;
    }
    revenue.ref += i.planned_quantity * ref;
    revenue.min += i.planned_quantity * (p?.min_price || ref);
    revenue.max += i.planned_quantity * (p?.max_price || ref);
  }

  return (
    <>
      <Anchor component={Link} to="/lotes" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Lotes
        </Group>
      </Anchor>
      <PageHeader title="Nuevo lote de producción" />
      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder>
            <Stack>
              <TextInput label="Fecha" type="date" value={productionDate} onChange={(e) => setProductionDate(e.currentTarget.value)} />
              <TextInput
                label="Código del lote"
                placeholder={nextCode.data ?? 'Automático'}
                description="Déjalo vacío para usar el consecutivo"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
              />
              <Textarea label="Notas" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} autosize minRows={3} />
            </Stack>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack>
            <Card withBorder>
              <Title order={5} mb="xs">
                Productos del lote
              </Title>
              <BatchItemsEditor
                rows={items}
                onChange={setItems}
                products={products.data?.items ?? []}
                mixtures={mixtures.data ?? []}
                estimatedCosts={preview.data?.items.map((i) => i.estimated_unit_cost)}
              />
            </Card>
            <Card withBorder>
              <Group justify="space-between" mb="xs">
                <Title order={5}>Materia prima a consumir</Title>
                {touched && (
                  <Button size="xs" variant="subtle" onClick={() => setTouched(false)}>
                    Recalcular desde las recetas
                  </Button>
                )}
              </Group>
              {inputs.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Elige al menos un producto para calcular los materiales a partir de su receta.
                </Text>
              ) : (
                <>
                  <Text size="sm" c="dimmed" mb="sm">
                    Suma de las recetas de todos los productos. Ajusta las cantidades si una misma tanda rinde distinto.
                  </Text>
                  <BatchMaterialsEditor
                    rows={rows}
                    onChange={(r) => {
                      setTouched(true);
                      setRows(r);
                    }}
                    materials={mats}
                    showStock
                  />
                  <Text size="sm" ta="right" mt="xs" c="dimmed">
                    Costo promedio por unidad: {money(total / Math.max(inputs.reduce((s, i) => s + i.planned_quantity, 0), 1))}
                  </Text>
                </>
              )}
            </Card>
            {inputs.length > 0 && (
              <Card withBorder>
                <ProfitSummary
                  revenue={revenue.ref}
                  profit={revenue.ref - total}
                  revenueMin={revenue.min}
                  revenueMax={revenue.max}
                  profitMin={revenue.min - total}
                  profitMax={revenue.max - total}
                  withoutPrice={revenue.withoutPrice}
                />
              </Card>
            )}
            <Group justify="flex-end">
              <Button onClick={() => create.mutate()} loading={create.isPending} disabled={inputs.length === 0}>
                Crear lote
              </Button>
            </Group>
          </Stack>
        </Grid.Col>
      </Grid>
    </>
  );
}
