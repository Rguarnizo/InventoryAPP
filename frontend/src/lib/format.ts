import type { BatchStatus, MixtureType, MovementType, ProductType, Unit } from '../api/types';

let currency = 'COP';
export const setCurrency = (c: string) => {
  currency = c;
};

export function money(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function num(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: decimals }).format(value);
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 0 }).format(value);
}

/** Cantidad con unidad, pasando a kg/L cuando es grande. */
export function qty(value: number, unit: Unit): string {
  if (unit === 'unidad') return `${num(value, 1)} u`;
  if (Math.abs(value) >= 1000) return `${num(value / 1000, 2)} ${unit === 'g' ? 'kg' : 'L'}`;
  return `${num(value, 1)} ${unit}`;
}

export function date(value: string | null | undefined): string {
  if (!value) return '—';
  const d = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function dateTime(value: string): string {
  return new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

export const PRODUCT_TYPES: Record<ProductType, string> = {
  concreto: 'Concreto',
  vela: 'Vela',
  concreto_con_vela: 'Concreto con vela',
  otro: 'Otro',
};

export const MIXTURE_TYPES: Record<MixtureType, string> = {
  concreto: 'Concreto',
  cera: 'Cera',
  otro: 'Otro',
};

export const UNITS: Record<Unit, string> = { g: 'Gramos (g)', ml: 'Mililitros (ml)', unidad: 'Unidades' };

export const BATCH_STATUS: Record<BatchStatus, { label: string; color: string }> = {
  planificado: { label: 'Planificado', color: 'gray' },
  en_proceso: { label: 'En proceso', color: 'blue' },
  terminado: { label: 'Terminado', color: 'teal' },
  cancelado: { label: 'Cancelado', color: 'red' },
};

export const MOVEMENT_TYPES: Record<MovementType, string> = {
  compra: 'Compra',
  ajuste: 'Ajuste',
  consumo_lote: 'Consumo de lote',
  reversion_lote: 'Reversión de lote',
  produccion: 'Producción',
  venta: 'Venta',
};

export const toOptions = (record: Record<string, string>) =>
  Object.entries(record).map(([value, label]) => ({ value, label }));
