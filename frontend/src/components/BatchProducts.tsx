import { Avatar, Group, Text, Tooltip } from '@mantine/core';
import type { BatchItem } from '../api/types';
import { ProductThumb } from './ProductThumb';

/** Resumen compacto de los productos de un lote: miniaturas y "Luna ×10, Manos ×5". */
export function BatchProducts({ items, max = 3 }: { items: BatchItem[]; max?: number }) {
  const label = items.map((i) => `${i.product.name} ×${i.planned_quantity}`).join(', ');
  return (
    <Tooltip label={label} disabled={items.length <= 1} multiline maw={320}>
      <Group gap="xs" wrap="nowrap">
        <Avatar.Group spacing={10}>
          {items.slice(0, max).map((i) => (
            <ProductThumb key={i.id} url={i.product.thumb_url} type={i.product.type} size={30} />
          ))}
          {items.length > max && <Avatar size={30} radius="sm">+{items.length - max}</Avatar>}
        </Avatar.Group>
        <Text size="sm" lineClamp={2} miw={130} maw={200}>
          {items.length === 1 ? items[0].product.name : `${items.length} productos: ${label}`}
        </Text>
      </Group>
    </Tooltip>
  );
}
