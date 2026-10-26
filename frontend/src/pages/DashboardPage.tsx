import { Alert, Anchor, Badge, Card, Group, Loader, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import type { BatchStatus, Dashboard } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { BATCH_STATUS, date, money, num, qty } from '../lib/format';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card withBorder padding="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} mt={4}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });

  if (isLoading || !data) return <Loader />;

  return (
    <>
      <PageHeader title="Resumen" />
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} mb="lg">
        <Stat label="Productos activos" value={num(data.products)} hint={`${data.products_in_stock} con stock`} />
        <Stat label="Unidades terminadas" value={num(data.finished_units)} hint={`Valor de venta ${money(data.stock_value_at_sale)}`} />
        <Stat label="Materia prima en bodega" value={money(data.materials_value)} hint={`${data.materials} materiales`} />
        <Stat label="Inversión en moldes" value={money(data.molds_investment)} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>Lotes recientes</Title>
            <Group gap={6}>
              {(Object.keys(BATCH_STATUS) as BatchStatus[]).map((s) =>
                data.batches_by_status[s] ? (
                  <Badge key={s} color={BATCH_STATUS[s].color} variant="light">
                    {BATCH_STATUS[s].label}: {data.batches_by_status[s]}
                  </Badge>
                ) : null,
              )}
            </Group>
          </Group>
          {data.recent_batches.length === 0 ? (
            <Text c="dimmed" size="sm">
              Aún no hay lotes. <Anchor component={Link} to="/lotes/nuevo" size="sm">
                Crea el primero
              </Anchor>.
            </Text>
          ) : (
            <Table highlightOnHover>
              <Table.Tbody>
                {data.recent_batches.map((b) => (
                  <Table.Tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/lotes/${b.id}`)}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {b.code}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {date(b.production_date)}
                      </Text>
                    </Table.Td>
                    <Table.Td>{b.product.name}</Table.Td>
                    <Table.Td ta="right">{b.planned_quantity} u</Table.Td>
                    <Table.Td>
                      <StatusBadge status={b.status} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">
            Materia prima bajo el mínimo
          </Title>
          {data.low_stock_materials.length === 0 ? (
            <Text c="dimmed" size="sm">
              Todo en orden. Define un stock mínimo en <Anchor component={Link} to="/materia-prima" size="sm">
                Materia prima
              </Anchor> para recibir alertas.
            </Text>
          ) : (
            <Stack gap="xs">
              {data.low_stock_materials.map((m) => (
                <Alert key={m.id} color="orange" icon={<IconAlertTriangle size={18} />} p="xs">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>
                      {m.name}
                    </Text>
                    <Text size="sm">
                      {qty(m.stock, m.unit)} / mín. {qty(m.min_stock, m.unit)}
                    </Text>
                  </Group>
                </Alert>
              ))}
            </Stack>
          )}
        </Card>
      </SimpleGrid>
    </>
  );
}
