import { useSearchParams } from 'react-router';
import type { ListParams } from '../api/types';

/** Estado de una tabla (página, orden, filtros) guardado en la URL para poder compartir/volver. */
export function useListState(defaults: { sort: string; order: 'asc' | 'desc'; size?: number }) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const size = Number(params.get('size') ?? defaults.size ?? 25);
  const sort = params.get('sort') ?? defaults.sort;
  const order = (params.get('order') as 'asc' | 'desc') ?? defaults.order;

  const update = (changes: Record<string, string | number | null | undefined>, resetPage = true) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === undefined || v === '') next.delete(k);
          else next.set(k, String(v));
        }
        if (resetPage && !('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  const filter = (key: string) => params.get(key) ?? '';

  const query: ListParams = { page, size, sort, order };
  params.forEach((value, key) => {
    if (!(key in query)) query[key] = value;
  });

  return {
    page,
    size,
    sort,
    order,
    query,
    filter,
    setFilter: (key: string, value: string | null) => update({ [key]: value }),
    setPage: (p: number) => update({ page: p }, false),
    setSize: (s: number) => update({ size: s }),
    setSort: (s: string, o: 'asc' | 'desc') => update({ sort: s, order: o }),
  };
}
