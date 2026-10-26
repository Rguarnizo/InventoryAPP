import { Badge } from '@mantine/core';
import type { BatchStatus } from '../api/types';
import { BATCH_STATUS } from '../lib/format';

export function StatusBadge({ status }: { status: BatchStatus }) {
  const { label, color } = BATCH_STATUS[status];
  return (
    <Badge color={color} variant="light" styles={{ root: { overflow: 'visible' }, label: { overflow: 'visible' } }}>
      {label}
    </Badge>
  );
}
