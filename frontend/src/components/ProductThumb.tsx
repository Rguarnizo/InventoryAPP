import { Avatar } from '@mantine/core';
import { IconCandle, IconCube } from '@tabler/icons-react';
import type { ProductType } from '../api/types';

export function ProductThumb({ url, type, size = 40 }: { url: string | null; type: ProductType; size?: number }) {
  const Icon = type === 'vela' ? IconCandle : IconCube;
  return (
    <Avatar src={url} size={size} radius="sm" color="grape" variant="light">
      <Icon size={size * 0.55} stroke={1.5} />
    </Avatar>
  );
}
