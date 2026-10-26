import { useEffect, useState } from 'react';
import {
  Anchor,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Image,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconArrowLeft, IconPhoto, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { Batch, Material, Mixture, Page, ProductDetail, ProductFields } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { ProductThumb } from '../components/ProductThumb';
import { newRowKey, RecipeEditor, RecipeRow } from '../components/RecipeEditor';
import { StatusBadge } from '../components/StatusBadge';
import { date, money, num, percent, PRODUCT_TYPES, toOptions } from '../lib/format';
import { notifyError, notifyOk } from '../lib/notify';

const EMPTY: ProductFields = {
  code: '',
  name: '',
  type: 'concreto',
  category: null,
  description: null,
  can_be_candle: false,
  water_weight_ml: null,
  mold_price: null,
  mold_count: 1,
  min_price: null,
  max_price: null,
  sale_price: null,
  active: true,
};

const numOrNull = (v: string | number) => (v === '' || v === null ? null : Number(v));

function MoneyInput(props: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <NumberInput
      label={props.label}
      value={props.value ?? ''}
      onChange={(v) => props.onChange(numOrNull(v))}
      min={0}
      thousandSeparator="."
      decimalSeparator=","
      prefix="$ "
      allowDecimal={false}
    />
  );
}

export function ProductPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const product = useQuery({
    queryKey: ['products', Number(id)],
    queryFn: () => api.get<ProductDetail>(`/products/${id}`),
    enabled: !isNew,
  });
  const materials = useQuery({
    queryKey: ['materials', 'all'],
    queryFn: () => api.get<Page<Material>>('/materials', { size: 500 }),
  });
  const mixtures = useQuery({ queryKey: ['mixtures'], queryFn: () => api.get<Mixture[]>('/mixtures') });
  const batches = useQuery({
    queryKey: ['batches', 'product', Number(id)],
    queryFn: () => api.get<Batch[]>(`/products/${id}/batches`),
    enabled: !isNew,
  });
  const categories = useQuery({ queryKey: ['products', 'categories'], queryFn: () => api.get<string[]>('/products/categories') });

  const [form, setForm] = useState<ProductFields>(EMPTY);
  const [stock, setStock] = useState(0);
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [newCategory, setNewCategory] = useState<string[]>([]);

  useEffect(() => {
    if (!product.data) return;
    const { components, ...rest } = product.data;
    const fields = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, rest[k as keyof ProductFields]]));
    setForm(fields as unknown as ProductFields);
    setStock(rest.stock);
    setRows(
      components.map((c) => ({
        key: newRowKey(),
        mixture_id: c.mixture?.id ?? null,
        material_id: c.material?.id ?? null,
        quantity: c.quantity,
      })),
    );
  }, [product.data]);

  const set = <K extends keyof ProductFields>(key: K, value: ProductFields[K]) => setForm((f) => ({ ...f, [key]: value }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const components = rows
        .filter((r) => (r.mixture_id || r.material_id) && r.quantity > 0)
        .map(({ mixture_id, material_id, quantity }) => ({ mixture_id, material_id, quantity }));
      if (isNew) return api.post<ProductDetail>('/products', { ...form, stock, components });
      await api.put(`/products/${id}`, { ...form, stock });
      return api.put<ProductDetail>(`/products/${id}/components`, components);
    },
    onSuccess: (p) => {
      invalidate();
      notifyOk('Producto guardado');
      if (isNew) navigate(`/productos/${p.id}`, { replace: true });
    },
    onError: notifyError,
  });

  const uploadPhoto = useMutation({
    mutationFn: (file: File) => {
      const data = new FormData();
      data.append('file', file);
      return api.post<ProductDetail>(`/products/${id}/photo`, data);
    },
    onSuccess: () => {
      invalidate();
      notifyOk('Foto actualizada');
    },
    onError: notifyError,
  });

  const removePhoto = useMutation({
    mutationFn: () => api.delete(`/products/${id}/photo`),
    onSuccess: invalidate,
    onError: notifyError,
  });

  const remove = () =>
    modals.openConfirmModal({
      title: 'Eliminar producto',
      children: <Text size="sm">¿Seguro que quieres eliminar «{form.name}»? Esta acción no se puede deshacer.</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        api
          .delete(`/products/${id}`)
          .then(() => {
            invalidate();
            navigate('/productos');
          })
          .catch(notifyError),
    });

  if (!isNew && (product.isLoading || !product.data)) return <Loader />;
  const p = product.data;

  // Costo alternativo cambiando la mezcla de cera de cada componente
  const waxMixtures = (mixtures.data ?? []).filter((m) => m.type === 'cera');
  const waxComponent = p?.components.find((c) => c.mixture?.type === 'cera');

  return (
    <>
      <Anchor component={Link} to="/productos" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Productos
        </Group>
      </Anchor>
      <PageHeader
        title={isNew ? 'Nuevo producto' : form.name || p?.name}
        subtitle={p ? `${p.code} · ${PRODUCT_TYPES[p.type]}` : undefined}
        actions={
          <>
            {!isNew && (
              <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={remove}>
                Eliminar
              </Button>
            )}
            {!isNew && (
              <Button variant="default" component={Link} to={`/lotes/nuevo?product=${id}`} leftSection={<IconPlus size={16} />}>
                Nuevo lote
              </Button>
            )}
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              Guardar
            </Button>
          </>
        }
      />

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack>
            <Card withBorder>
              {isNew ? (
                <Text size="sm" c="dimmed">
                  Guarda el producto para poder subir su foto.
                </Text>
              ) : (
                <Stack gap="sm">
                  {p?.photo_url ? (
                    <Image src={p.photo_url} alt={p.name} radius="md" />
                  ) : (
                    <Group justify="center" py="md">
                      <ProductThumb url={null} type={form.type} size={120} />
                    </Group>
                  )}
                  <Dropzone
                    onDrop={(files) => files[0] && uploadPhoto.mutate(files[0])}
                    onReject={() => notifyError('Archivo no válido (máx. 10 MB, solo imágenes)')}
                    accept={IMAGE_MIME_TYPE}
                    maxSize={10 * 1024 * 1024}
                    multiple={false}
                    loading={uploadPhoto.isPending}
                    p="sm"
                  >
                    <Group justify="center" gap="xs" mih={50} style={{ pointerEvents: 'none' }}>
                      <IconPhoto size={22} stroke={1.5} />
                      <Text size="sm">{p?.photo_url ? 'Cambiar foto' : 'Subir foto'} (arrastra o haz clic)</Text>
                    </Group>
                  </Dropzone>
                  {p?.photo_url && (
                    <Button variant="subtle" color="red" size="xs" onClick={() => removePhoto.mutate()}>
                      Quitar foto
                    </Button>
                  )}
                </Stack>
              )}
            </Card>

            {p && (
              <Card withBorder>
                <Title order={5} mb="xs">
                  Costos
                </Title>
                <Table>
                  <Table.Tbody>
                    <Table.Tr>
                      <Table.Td>Costo estimado</Table.Td>
                      <Table.Td ta="right" fw={700}>
                        {money(p.estimated_cost)}
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Peso</Table.Td>
                      <Table.Td ta="right">{p.weight_g ? `${num(p.weight_g)} g` : '—'}</Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Margen (sobre {p.sale_price ? 'precio de venta' : 'precio mínimo'})</Table.Td>
                      <Table.Td ta="right">{percent(p.margin)}</Table.Td>
                    </Table.Tr>
                    {p.mold_price ? (
                      <Table.Tr>
                        <Table.Td>Unidades para pagar el molde</Table.Td>
                        <Table.Td ta="right">
                          {p.min_price && p.min_price > p.estimated_cost
                            ? num(Math.ceil(p.mold_price / (p.min_price - p.estimated_cost)))
                            : '—'}
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                  </Table.Tbody>
                </Table>
                {waxComponent && waxMixtures.length > 1 && (
                  <>
                    <Text size="sm" fw={600} mt="md" mb={4}>
                      Costo según la cera
                    </Text>
                    <Table>
                      <Table.Tbody>
                        {waxMixtures.map((m) => (
                          <Table.Tr key={m.id}>
                            <Table.Td>
                              {m.name}
                              {m.id === waxComponent.mixture?.id && (
                                <Badge size="xs" ml={6} variant="light">
                                  actual
                                </Badge>
                              )}
                            </Table.Td>
                            <Table.Td ta="right">
                              {money(p.estimated_cost - waxComponent.cost + waxComponent.quantity * m.cost_per_unit)}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </>
                )}
              </Card>
            )}
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack>
            <Card withBorder>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label="Código" value={form.code} onChange={(e) => set('code', e.currentTarget.value)} required />
                <TextInput label="Referencia / nombre" value={form.name} onChange={(e) => set('name', e.currentTarget.value)} required />
                <Select
                  label="Tipo"
                  data={toOptions(PRODUCT_TYPES)}
                  value={form.type}
                  onChange={(v) => v && set('type', v as ProductFields['type'])}
                  allowDeselect={false}
                />
                <Select
                  label="Categoría / colección"
                  data={[...new Set([...(categories.data ?? []), ...newCategory])]}
                  value={form.category}
                  onChange={(v) => set('category', v)}
                  searchable
                  clearable
                  nothingFoundMessage="Escribe y presiona Enter para crearla"
                  onKeyDown={(e) => {
                    const value = (e.currentTarget as HTMLInputElement).value.trim();
                    if (e.key === 'Enter' && value) {
                      setNewCategory((c) => [...c, value]);
                      set('category', value);
                    }
                  }}
                />
                <MoneyInput label="Precio mínimo" value={form.min_price} onChange={(v) => set('min_price', v)} />
                <MoneyInput label="Precio máximo" value={form.max_price} onChange={(v) => set('max_price', v)} />
                <MoneyInput label="Precio de venta" value={form.sale_price} onChange={(v) => set('sale_price', v)} />
                <MoneyInput label="Precio del molde" value={form.mold_price} onChange={(v) => set('mold_price', v)} />
                <NumberInput
                  label="Cantidad de moldes"
                  value={form.mold_count}
                  onChange={(v) => set('mold_count', Number(v) || 0)}
                  min={0}
                  allowDecimal={false}
                />
                <NumberInput
                  label="Peso agua del molde (ml)"
                  description="Volumen del molde; el concreto pesa ≈ 2× este valor"
                  value={form.water_weight_ml ?? ''}
                  onChange={(v) => set('water_weight_ml', numOrNull(v))}
                  min={0}
                />
                <NumberInput
                  label="Stock (unidades terminadas)"
                  description="Cambiarlo registra un ajuste de inventario"
                  value={stock}
                  onChange={(v) => setStock(Number(v) || 0)}
                  min={0}
                  allowDecimal={false}
                />
                <Stack gap="xs" justify="center">
                  <Switch label="Puede ser vela (contenedor)" checked={form.can_be_candle} onChange={(e) => set('can_be_candle', e.currentTarget.checked)} />
                  <Switch label="Activo" checked={form.active} onChange={(e) => set('active', e.currentTarget.checked)} />
                </Stack>
              </SimpleGrid>
              <Textarea
                mt="sm"
                label="Descripción / notas"
                value={form.description ?? ''}
                onChange={(e) => set('description', e.currentTarget.value || null)}
                autosize
                minRows={2}
              />
            </Card>

            <Card withBorder>
              <Group justify="space-between" mb="xs">
                <Title order={5}>Receta por unidad</Title>
                {form.water_weight_ml && rows.length === 0 && (mixtures.data ?? []).some((m) => m.type === 'concreto') && (
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => {
                      const concrete = mixtures.data!.find((m) => m.type === 'concreto')!;
                      setRows([{ key: newRowKey(), mixture_id: concrete.id, material_id: null, quantity: form.water_weight_ml! * 2 }]);
                    }}
                  >
                    Usar {num(form.water_weight_ml * 2)} g de concreto
                  </Button>
                )}
              </Group>
              <RecipeEditor rows={rows} onChange={setRows} materials={materials.data?.items ?? []} mixtures={mixtures.data ?? []} />
            </Card>

            {!isNew && (
              <Card withBorder>
                <Group justify="space-between" mb="xs">
                  <Title order={5}>Lotes de este producto</Title>
                  <AdjustStock productId={Number(id)} onDone={invalidate} />
                </Group>
                {batches.data && batches.data.length > 0 ? (
                  <Table highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Lote</Table.Th>
                        <Table.Th>Fecha</Table.Th>
                        <Table.Th ta="right">Buenas</Table.Th>
                        <Table.Th ta="right">Costo unitario</Table.Th>
                        <Table.Th>Estado</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {batches.data.map((b) => (
                        <Table.Tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/lotes/${b.id}`)}>
                          <Table.Td fw={600}>{b.code}</Table.Td>
                          <Table.Td>{date(b.production_date)}</Table.Td>
                          <Table.Td ta="right">{b.status === 'terminado' ? b.good_quantity : `${b.planned_quantity} (plan.)`}</Table.Td>
                          <Table.Td ta="right">{money(b.unit_cost)}</Table.Td>
                          <Table.Td>
                            <StatusBadge status={b.status} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                ) : (
                  <Text size="sm" c="dimmed">
                    Sin lotes registrados.
                  </Text>
                )}
              </Card>
            )}
          </Stack>
        </Grid.Col>
      </Grid>
    </>
  );
}

function AdjustStock({ productId, onDone }: { productId: number; onDone: () => void }) {
  const [opened, { open, close }] = useDisclosure();
  const [type, setType] = useState<'venta' | 'ajuste'>('venta');
  const [quantity, setQuantity] = useState<number>(1);
  const [note, setNote] = useState('');
  const queryClient = useQueryClient();

  const submit = useMutation({
    mutationFn: () => api.post(`/products/${productId}/adjust`, { type, quantity, note: note || null }),
    onSuccess: () => {
      onDone();
      queryClient.invalidateQueries({ queryKey: ['products', productId] });
      notifyOk(type === 'venta' ? 'Venta registrada' : 'Ajuste registrado');
      close();
      setNote('');
    },
    onError: notifyError,
  });

  return (
    <>
      <Button size="xs" variant="light" onClick={open}>
        Registrar venta / ajuste
      </Button>
      <Modal opened={opened} onClose={close} title="Movimiento de producto terminado">
        <Stack>
          <SegmentedControl
            value={type}
            onChange={(v) => setType(v as 'venta' | 'ajuste')}
            data={[
              { value: 'venta', label: 'Venta (resta)' },
              { value: 'ajuste', label: 'Ajuste (+/−)' },
            ]}
          />
          <NumberInput label="Unidades" value={quantity} onChange={(v) => setQuantity(Number(v) || 0)} allowDecimal={false} />
          <TextInput label="Nota" value={note} onChange={(e) => setNote(e.currentTarget.value)} placeholder="Cliente, feria, motivo…" />
          <Button onClick={() => submit.mutate()} loading={submit.isPending} disabled={!quantity}>
            Guardar
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
