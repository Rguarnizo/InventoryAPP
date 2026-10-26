import { ReactNode, useState } from 'react';
import {
  ActionIcon,
  Center,
  Checkbox,
  Group,
  Loader,
  Menu,
  Pagination,
  ScrollArea,
  Select,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconColumns, IconSelector } from '@tabler/icons-react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /** Oculta la columna por defecto (el usuario puede mostrarla) */
  hidden?: boolean;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
  onSort?: (key: string, order: 'asc' | 'desc') => void;
  page?: number;
  size?: number;
  total?: number;
  onPage?: (page: number) => void;
  onSize?: (size: number) => void;
  onRowClick?: (row: T) => void;
  rowStyle?: (row: T) => React.CSSProperties | undefined;
  /** Clave para recordar las columnas visibles en este navegador */
  storageKey?: string;
  empty?: ReactNode;
}

function loadHidden(storageKey: string | undefined, columns: Column<unknown>[]): Set<string> {
  if (storageKey) {
    try {
      const saved = localStorage.getItem(`luci.columns.${storageKey}`);
      if (saved) return new Set(JSON.parse(saved));
    } catch {
      /* ignorar */
    }
  }
  return new Set(columns.filter((c) => c.hidden).map((c) => c.key));
}

export function DataTable<T>(props: Props<T>) {
  const { columns, rows, rowKey, loading, sort, order = 'asc', onSort, onRowClick, rowStyle } = props;
  const [hidden, setHidden] = useState(() => loadHidden(props.storageKey, columns as Column<unknown>[]));
  const visible = columns.filter((c) => !hidden.has(c.key));

  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    if (props.storageKey) {
      try {
        localStorage.setItem(`luci.columns.${props.storageKey}`, JSON.stringify([...next]));
      } catch {
        /* ignorar */
      }
    }
  };

  const header = (col: Column<T>) => {
    if (!col.sortable || !onSort) return col.header;
    const active = sort === col.key;
    const Icon = active ? (order === 'asc' ? IconChevronUp : IconChevronDown) : IconSelector;
    return (
      <UnstyledButton
        onClick={() => onSort(col.key, active && order === 'asc' ? 'desc' : 'asc')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
        aria-label={`Ordenar por ${col.header}`}
      >
        {col.header}
        <Icon size={14} stroke={1.8} opacity={active ? 1 : 0.4} />
      </UnstyledButton>
    );
  };

  const totalPages = props.total && props.size ? Math.max(Math.ceil(props.total / props.size), 1) : 1;

  return (
    <div>
      <ScrollArea type="auto" offsetScrollbars>
        <Table striped highlightOnHover={!!onRowClick} verticalSpacing="xs" miw={600}>
          <Table.Thead>
            <Table.Tr>
              {visible.map((col) => (
                <Table.Th key={col.key} style={{ textAlign: col.align, width: col.width, whiteSpace: 'nowrap' }}>
                  {header(col)}
                </Table.Th>
              ))}
              {props.storageKey && (
                <Table.Th w={40}>
                  <Menu closeOnItemClick={false} position="bottom-end" withinPortal>
                    <Menu.Target>
                      <Tooltip label="Columnas">
                        <ActionIcon variant="subtle" color="gray" aria-label="Elegir columnas">
                          <IconColumns size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {columns.map((col) => (
                        <Menu.Item key={col.key} onClick={() => toggle(col.key)}>
                          <Checkbox label={col.header} checked={!hidden.has(col.key)} readOnly size="xs" />
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Th>
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows?.map((row) => (
              <Table.Tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{ cursor: onRowClick ? 'pointer' : undefined, ...rowStyle?.(row) }}
              >
                {visible.map((col) => (
                  <Table.Td key={col.key} style={{ textAlign: col.align }}>
                    {col.render(row)}
                  </Table.Td>
                ))}
                {props.storageKey && <Table.Td />}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {loading && !rows && (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      )}
      {rows && rows.length === 0 && (
        <Center py="xl">
          <Text c="dimmed">{props.empty ?? 'Sin resultados'}</Text>
        </Center>
      )}
      {props.onPage && props.total !== undefined && (
        <Group justify="space-between" mt="md" wrap="wrap">
          <Text size="sm" c="dimmed">
            {props.total} registro{props.total === 1 ? '' : 's'}
          </Text>
          <Group gap="sm">
            {props.onSize && (
              <Select
                size="xs"
                w={90}
                data={['10', '25', '50', '100']}
                value={String(props.size)}
                onChange={(v) => v && props.onSize!(Number(v))}
                allowDeselect={false}
                aria-label="Filas por página"
              />
            )}
            <Pagination size="sm" total={totalPages} value={props.page} onChange={props.onPage} />
          </Group>
        </Group>
      )}
    </div>
  );
}
