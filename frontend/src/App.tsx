import { useEffect, useSyncExternalStore } from 'react';
import { Route, Routes } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, auth } from './api/client';
import { Layout } from './components/Layout';
import { setCurrency } from './lib/format';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductPage } from './pages/ProductPage';
import { MaterialsPage } from './pages/MaterialsPage';
import { MixturesPage } from './pages/MixturesPage';
import { BatchesPage } from './pages/BatchesPage';
import { BatchPage } from './pages/BatchPage';
import { BatchNewPage } from './pages/BatchNewPage';
import { NotFoundPage } from './pages/NotFoundPage';

const subscribe = (cb: () => void) => {
  window.addEventListener('luci-auth', cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener('luci-auth', cb);
    window.removeEventListener('storage', cb);
  };
};

export function App() {
  const token = useSyncExternalStore(subscribe, () => auth.token);
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<{ currency: string }>('/config') });

  useEffect(() => {
    if (config.data) setCurrency(config.data.currency);
  }, [config.data]);

  if (!token) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="productos" element={<ProductsPage />} />
        <Route path="productos/nuevo" element={<ProductPage />} />
        <Route path="productos/:id" element={<ProductPage />} />
        <Route path="lotes" element={<BatchesPage />} />
        <Route path="lotes/nuevo" element={<BatchNewPage />} />
        <Route path="lotes/:id" element={<BatchPage />} />
        <Route path="materia-prima" element={<MaterialsPage />} />
        <Route path="mezclas" element={<MixturesPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
