import { AppShell, Burger, Group, NavLink, Text, ActionIcon, Tooltip, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBox,
  IconFlask,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconPackages,
  IconStack2,
  IconSun,
} from '@tabler/icons-react';
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { auth } from '../api/client';

const LINKS = [
  { to: '/', label: 'Resumen', icon: IconLayoutDashboard, end: true },
  { to: '/productos', label: 'Productos', icon: IconBox },
  { to: '/lotes', label: 'Lotes de producción', icon: IconStack2 },
  { to: '/materia-prima', label: 'Materia prima', icon: IconPackages },
  { to: '/mezclas', label: 'Mezclas', icon: IconFlask },
];

export function Layout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const queryClient = useQueryClient();

  const logout = () => {
    auth.set(null);
    queryClient.clear();
  };

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menú" />
            <img src="/favicon.svg" width={28} height={28} alt="" />
            <Text fw={700} size="lg">
              Luci Notturne
            </Text>
            <Text c="dimmed" size="sm" visibleFrom="xs">
              Inventario
            </Text>
          </Group>
          <Group gap="xs">
            <Tooltip label={colorScheme === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
              <ActionIcon variant="default" onClick={toggleColorScheme} aria-label="Cambiar tema">
                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Cerrar sesión">
              <ActionIcon variant="default" onClick={logout} aria-label="Cerrar sesión">
                <IconLogout size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {LINKS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            component={RouterLink}
            to={to}
            end={end}
            label={label}
            leftSection={<Icon size={18} stroke={1.6} />}
            active={end ? pathname === to : pathname.startsWith(to)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
