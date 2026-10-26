import { Button, FileButton, List, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ImportResult } from '../api/types';
import { notifyError } from '../lib/notify';

/** Botones para exportar/importar una entidad como CSV. */
export function CsvButtons({ entity, filename, invalidate }: { entity: string; filename: string; invalidate: string[] }) {
  const queryClient = useQueryClient();

  const upload = async (file: File | null) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const result = await api.post<ImportResult>(`/import/${entity}`, form);
      invalidate.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      modals.open({
        title: 'Importación terminada',
        children: (
          <>
            <Text>
              {result.created} creados, {result.updated} actualizados.
            </Text>
            {result.errors.length > 0 && (
              <>
                <Text c="red" mt="sm" fw={600}>
                  {result.errors.length} filas con errores:
                </Text>
                <List size="sm">
                  {result.errors.map((e) => (
                    <List.Item key={e}>{e}</List.Item>
                  ))}
                </List>
              </>
            )}
          </>
        ),
      });
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <>
      <Button
        variant="default"
        leftSection={<IconDownload size={16} />}
        onClick={() => api.download(`/export/${entity}`, filename).catch(notifyError)}
      >
        Exportar CSV
      </Button>
      <FileButton onChange={upload} accept=".csv,text/csv">
        {(props) => (
          <Button variant="default" leftSection={<IconUpload size={16} />} {...props}>
            Importar CSV
          </Button>
        )}
      </FileButton>
    </>
  );
}
