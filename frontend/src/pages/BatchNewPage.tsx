import { useEffect, useState } from 'react';
import { Anchor, Button, Card, Grid, Group, NumberInput, Select, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { BatchDetail, Material, Mixture, Page, Product, ProductCost, ProductDetail } from '../api/types';
import { BatchMaterialRow, BatchMaterialsEditor } from '../components/BatchMaterialsEditor';
import { PageHeader } from '../components/PageHeader';
import { money, num } from '../lib/format';
import { notifyError, notifyOk } from '../lib/notify';

const today = () => new Date().toLocaleDateString('en-CA');

export function BatchNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [productId, setProductId] = useState<string | null>(params.get('product'));
  const [quantity, setQuantity] = useState(10);
  const [productionDate, setProductionDate] = useState(today());
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [rows, setRows] = useState<BatchMaterialRow[]>([]);
  const [touched, setTouched] = useState(false);
  const [debouncedQty] = useDebouncedValue(quantity, 300);

  const products = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api.get<Page<Product>>('/products', { size: 500, sort: 'name' }),
  });
  const product = useQuery({
    queryKey: ['products', Number(productId)],
    queryFn: () => api.get<ProductDetail>(`/products/${productId}`),
    enabled: !!productId,
  });
  const mixtures = useQuery({ queryKey: ['mixtures'], queryFn: () => api.get<Mixture[]>('/mixtures') });
  const materials = useQuery({
    queryKey: ['materials', 'all'],
    queryFn: () => api.get<Page<Material>>('/materials', { size: 500 }),
  });
  const nextCode = useQuery({ queryKey: ['batches', 'next-code'], queryFn: () => api.get<string>('/batches/next-code') });

  const preview = useQuery({
    queryKey: ['cost-preview', productId, debouncedQty, overrides],
    queryFn: () =>
      api.post<ProductCost>(`/products/${productId}/cost`, { quantity: debouncedQty, mixture_overrides: overrides }),
    enabled: !!productId && debouncedQty > 0,
  });

  // La receta recalculada reemplaza la tabla mientras el usuario no la haya editado a mano
  useEffect(() => {
    if (preview.data && !touched) {
      setRows(preview.data.lines.map((l) => ({ material_id: l.material.id, quantity: l.quantity })));
    }
  }, [preview.data, touched]);

  useEffect(() => {
    setOverrides({});
    setTouched(false);
  }, [productId]);

  const create = useMutation({
    mutationFn: () =>
      api.post<BatchDetail>('/batches', {
        product_id: Number(productId),
        planned_quantity: quantity,
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

  const mixtureComponents = product.data?.components.filter((c) => c.mixture) ?? [];
  const mats = materials.data?.items ?? [];
  const total = rows.reduce((s, r) => s + r.quantity * (mats.find((m) => m.id === r.material_id)?.unit_cost ?? 0), 0);

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
              <Select
                label="Producto"
                data={(products.data?.items ?? []).map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))}
                value={productId}
                onChange={setProductId}
                searchable
                required
              />
              <NumberInput
                label="Unidades a producir"
                value={quantity}
                onChange={(v) => setQuantity(Number(v) || 0)}
                min={1}
                allowDecimal={false}
              />
              <TextInput label="Fecha" type="date" value={productionDate} onChange={(e) => setProductionDate(e.currentTarget.value)} />
              <TextInput
                label="Código del lote"
                placeholder={nextCode.data ?? 'Automático'}
                description="Déjalo vacío para usar el consecutivo"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
              />
              {mixtureComponents.map((c) => {
                const options = (mixtures.data ?? []).filter((m) => m.type === c.mixture!.type);
                if (options.length < 2) return null;
                return (
                  <Select
                    key={c.id}
                    label={`Mezcla (${num(c.quantity)} g por unidad)`}
                    data={options.map((m) => ({ value: String(m.id), label: m.name }))}
                    value={String(overrides[c.id] ?? c.mixture!.id)}
                    onChange={(v) => {
                      setTouched(false);
                      setOverrides((o) => ({ ...o, [c.id]: Number(v) }));
                    }}
                    allowDeselect={false}
                  />
                );
              })}
              <Textarea label="Notas" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} autosize minRows={2} />
            </Stack>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder>
            <Group justify="space-between" mb="xs">
              <Title order={5}>Materia prima a consumir</Title>
              {touched && (
                <Button size="xs" variant="subtle" onClick={() => setTouched(false)}>
                  Recalcular desde la receta
                </Button>
              )}
            </Group>
            {!productId ? (
              <Text c="dimmed" size="sm">
                Elige un producto para calcular los materiales a partir de su receta.
              </Text>
            ) : product.data && product.data.components.length === 0 && rows.length === 0 ? (
              <Text c="dimmed" size="sm" mb="sm">
                Este producto no tiene receta. Agrega los materiales manualmente o{' '}
                <Anchor component={Link} to={`/productos/${productId}`} size="sm">
                  define su receta
                </Anchor>.
              </Text>
            ) : null}
            {productId && (
              <BatchMaterialsEditor
                rows={rows}
                onChange={(r) => {
                  setTouched(true);
                  setRows(r);
                }}
                materials={mats}
                showStock
              />
            )}
            {productId && quantity > 0 && (
              <Group justify="flex-end" mt="sm" gap="lg">
                <Text size="sm">
                  Costo por unidad: <b>{money(total / quantity)}</b>
                </Text>
                {product.data?.min_price ? (
                  <Text size="sm" c="dimmed">
                    Precio mínimo {money(product.data.min_price)}
                  </Text>
                ) : null}
              </Group>
            )}
          </Card>
          <Group justify="flex-end" mt="md">
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!productId || quantity < 1}>
              Crear lote
            </Button>
          </Group>
        </Grid.Col>
      </Grid>
    </>
  );
}
