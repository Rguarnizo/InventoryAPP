export type Unit = 'g' | 'ml' | 'unidad';
export type MixtureType = 'concreto' | 'cera' | 'otro';
export type ProductType = 'concreto' | 'vela' | 'concreto_con_vela' | 'otro';
export type BatchStatus = 'planificado' | 'en_proceso' | 'terminado' | 'cancelado';
export type MovementType = 'compra' | 'ajuste' | 'consumo_lote' | 'reversion_lote' | 'produccion' | 'venta';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface ListParams {
  page?: number;
  size?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  q?: string;
  [key: string]: string | number | boolean | undefined | null;
}

export interface MaterialRef {
  id: number;
  name: string;
  unit: Unit;
  unit_cost: number;
}

export interface Material extends MaterialRef {
  package_quantity: number;
  package_price: number;
  stock: number;
  min_stock: number;
  supplier: string | null;
  notes: string | null;
  low_stock: boolean;
  updated_at: string;
}

export type MaterialInput = Omit<Material, 'id' | 'unit_cost' | 'low_stock' | 'updated_at'>;

export interface Movement {
  id: number;
  type: MovementType;
  quantity: number;
  note: string | null;
  batch_id: number | null;
  material_id: number | null;
  product_id: number | null;
  created_at: string;
}

export interface MixtureRef {
  id: number;
  name: string;
  type: MixtureType;
}

export interface Mixture extends MixtureRef {
  notes: string | null;
  cost_per_unit: number;
  components: { id: number; material: MaterialRef; proportion: number }[];
}

export interface MixtureInput {
  name: string;
  type: MixtureType;
  notes: string | null;
  components: { material_id: number; proportion: number }[];
}

export interface ProductComponent {
  id: number;
  mixture: MixtureRef | null;
  material: MaterialRef | null;
  quantity: number;
  unit_cost: number;
  cost: number;
}

export interface ProductComponentInput {
  mixture_id: number | null;
  material_id: number | null;
  quantity: number;
}

export interface ProductFields {
  code: string;
  name: string;
  type: ProductType;
  category: string | null;
  description: string | null;
  can_be_candle: boolean;
  water_weight_ml: number | null;
  mold_price: number | null;
  mold_count: number;
  min_price: number | null;
  max_price: number | null;
  sale_price: number | null;
  active: boolean;
}

export interface Product extends ProductFields {
  id: number;
  stock: number;
  photo_url: string | null;
  thumb_url: string | null;
  weight_g: number | null;
  estimated_cost: number;
  margin: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProductDetail extends Product {
  components: ProductComponent[];
}

export interface CostLine {
  material: MaterialRef;
  quantity: number;
  unit_cost: number;
  cost: number;
}

export interface ProductCost {
  product_id: number;
  quantity: number;
  lines: CostLine[];
  total: number;
  unit_cost: number;
}

export interface ProductRef {
  id: number;
  code: string;
  name: string;
  type: ProductType;
  thumb_url: string | null;
  reference_price: number | null;
}

export interface BatchItem {
  id: number;
  product: ProductRef;
  planned_quantity: number;
  produced_quantity: number | null;
  defective_quantity: number;
  good_quantity: number;
  estimated_unit_cost: number;
  allocated_cost: number;
  unit_cost: number | null;
}

export interface BatchItemInput {
  product_id: number;
  planned_quantity: number;
  mixture_overrides?: Record<number, number>;
}

export interface Batch {
  id: number;
  code: string;
  production_date: string;
  status: BatchStatus;
  materials_consumed: boolean;
  items: BatchItem[];
  planned_quantity: number;
  good_quantity: number;
  total_cost: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BatchDetail extends Batch {
  materials: { id: number; material: MaterialRef; quantity: number; unit_cost: number }[];
}

export interface BatchPreview {
  items: { product_id: number; planned_quantity: number; estimated_unit_cost: number }[];
  lines: CostLine[];
  total: number;
}

export interface Dashboard {
  currency: string;
  products: number;
  products_in_stock: number;
  finished_units: number;
  stock_value_at_cost: number;
  stock_value_at_sale: number;
  materials: number;
  materials_value: number;
  low_stock_materials: Material[];
  batches_by_status: Partial<Record<BatchStatus, number>>;
  recent_batches: Batch[];
  molds_investment: number;
}

export interface ImportResult {
  created: number;
  updated: number;
  errors: string[];
}
