import { Button, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <Stack align="center" py="xl">
      <Title order={2}>Página no encontrada</Title>
      <Text c="dimmed">La dirección no existe.</Text>
      <Button component={Link} to="/">
        Ir al resumen
      </Button>
    </Stack>
  );
}
