import { notifications } from '@mantine/notifications';

export const notifyOk = (message: string) => notifications.show({ color: 'teal', message });

export const notifyError = (error: unknown) =>
  notifications.show({
    color: 'red',
    title: 'Error',
    message: error instanceof Error ? error.message : String(error),
    autoClose: 8000,
    style: { whiteSpace: 'pre-line' },
  });
