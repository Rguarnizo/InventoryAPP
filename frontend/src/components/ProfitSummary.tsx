import { Alert, Group, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { money, percent } from '../lib/format';

interface Props {
  revenue: number;
  profit: number;
  revenueMin?: number;
  revenueMax?: number;
  profitMin?: number;
  profitMax?: number;
  withoutPrice?: number;
  finished?: boolean;
}

/** Ganancia esperada si se vende todo el lote. */
export function ProfitSummary({ revenue, profit, profitMin, profitMax, revenueMin, revenueMax, withoutPrice = 0, finished }: Props) {
  const showRange = profitMin !== undefined && profitMax !== undefined && (profitMin !== profit || profitMax !== profit);
  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        Si se vende todo {finished ? '(unidades buenas)' : '(unidades planificadas)'}
      </Text>
      <Group justify="space-between">
        <Text size="sm">Ingreso por ventas</Text>
        <Text size="sm">{money(revenue)}</Text>
      </Group>
      <Group justify="space-between" align="baseline">
        <Text fw={600}>Ganancia</Text>
        <Text fw={700} size="xl" c={profit >= 0 ? 'teal' : 'red'}>
          {money(profit)}
        </Text>
      </Group>
      {revenue > 0 && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Margen
          </Text>
          <Text size="sm" c="dimmed">
            {percent(profit / revenue)}
          </Text>
        </Group>
      )}
      {showRange && (
        <Text size="xs" c="dimmed">
          Entre {money(profitMin)} (precio mínimo, {money(revenueMin)}) y {money(profitMax)} (precio máximo, {money(revenueMax)})
        </Text>
      )}
      {withoutPrice > 0 && (
        <Alert color="orange" p="xs" icon={<IconAlertTriangle size={16} />}>
          <Text size="xs">
            {withoutPrice} producto{withoutPrice > 1 ? 's' : ''} sin precio: no suma{withoutPrice > 1 ? 'n' : ''} al ingreso. Define su precio en la ficha del producto.
          </Text>
        </Alert>
      )}
    </Stack>
  );
}
