from datetime import date, datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import BatchStatus, MixtureType, MovementType, ProductType, Unit

T = TypeVar("T")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    size: int


# --- Auth ---
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(ORM):
    id: int
    username: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


# --- Materials ---
class MaterialBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    unit: Unit = Unit.g
    package_quantity: float = Field(gt=0)
    package_price: float = Field(ge=0)
    min_stock: float = Field(default=0, ge=0)
    supplier: str | None = None
    notes: str | None = None


class MaterialCreate(MaterialBase):
    stock: float = Field(default=0, ge=0)


class MaterialUpdate(MaterialBase):
    pass


class MaterialOut(ORM, MaterialBase):
    id: int
    stock: float
    unit_cost: float
    low_stock: bool
    updated_at: datetime


class MaterialRef(ORM):
    id: int
    name: str
    unit: Unit
    unit_cost: float


class StockAdjust(BaseModel):
    type: MovementType = MovementType.compra
    quantity: float = Field(description="Positivo suma, negativo resta (solo para ajuste)")
    package_price: float | None = Field(default=None, ge=0, description="Actualiza el precio de la presentación")
    note: str | None = None

    @model_validator(mode="after")
    def check(self):
        if self.type not in (MovementType.compra, MovementType.ajuste):
            raise ValueError("Solo se permiten movimientos de compra o ajuste")
        if self.type == MovementType.compra and self.quantity <= 0:
            raise ValueError("La cantidad de una compra debe ser positiva")
        return self


class MovementOut(ORM):
    id: int
    type: MovementType
    quantity: float
    note: str | None
    batch_id: int | None
    material_id: int | None
    product_id: int | None
    created_at: datetime


# --- Mixtures ---
class MixtureComponentIn(BaseModel):
    material_id: int
    proportion: float = Field(gt=0)


class MixtureComponentOut(ORM):
    id: int
    material: MaterialRef
    proportion: float


class MixtureIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: MixtureType = MixtureType.otro
    notes: str | None = None
    components: list[MixtureComponentIn] = Field(min_length=1)


class MixtureOut(ORM):
    id: int
    name: str
    type: MixtureType
    notes: str | None
    components: list[MixtureComponentOut]
    cost_per_unit: float


class MixtureRef(ORM):
    id: int
    name: str
    type: MixtureType


# --- Products ---
class ProductComponentIn(BaseModel):
    mixture_id: int | None = None
    material_id: int | None = None
    quantity: float = Field(gt=0)

    @model_validator(mode="after")
    def one_source(self):
        if (self.mixture_id is None) == (self.material_id is None):
            raise ValueError("Cada componente debe tener una mezcla o un material, no ambos")
        return self


class ProductComponentOut(ORM):
    id: int
    mixture: MixtureRef | None
    material: MaterialRef | None
    quantity: float
    unit_cost: float
    cost: float


class ProductBase(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=160)
    type: ProductType = ProductType.otro
    category: str | None = None
    description: str | None = None
    can_be_candle: bool = False
    water_weight_ml: float | None = Field(default=None, ge=0)
    mold_price: float | None = Field(default=None, ge=0)
    mold_count: int = Field(default=1, ge=0)
    min_price: float | None = Field(default=None, ge=0)
    max_price: float | None = Field(default=None, ge=0)
    sale_price: float | None = Field(default=None, ge=0)
    active: bool = True


class ProductCreate(ProductBase):
    stock: int = Field(default=0, ge=0)
    components: list[ProductComponentIn] = []


class ProductUpdate(ProductBase):
    stock: int | None = Field(default=None, ge=0)


class ProductOut(ORM, ProductBase):
    id: int
    stock: int
    photo_url: str | None
    thumb_url: str | None
    weight_g: float | None
    estimated_cost: float
    margin: float | None
    created_at: datetime
    updated_at: datetime


class ProductDetail(ProductOut):
    components: list[ProductComponentOut]


class CostLine(BaseModel):
    material: MaterialRef
    quantity: float
    unit_cost: float
    cost: float


class ProductCost(BaseModel):
    product_id: int
    quantity: int
    mixture_overrides: dict[int, int]
    lines: list[CostLine]
    total: float
    unit_cost: float


# --- Batches ---
class BatchMaterialIn(BaseModel):
    material_id: int
    quantity: float = Field(ge=0)


class BatchMaterialOut(ORM):
    id: int
    material: MaterialRef
    quantity: float
    unit_cost: float


class BatchItemIn(BaseModel):
    product_id: int
    planned_quantity: int = Field(gt=0)
    mixture_overrides: dict[int, int] = Field(
        default_factory=dict, description="component_id → mixture_id para cambiar la mezcla (p.ej. otra cera)"
    )


class BatchPreviewRequest(BaseModel):
    items: list[BatchItemIn] = Field(min_length=1)


class BatchPreviewItem(BaseModel):
    product_id: int
    planned_quantity: int
    estimated_unit_cost: float


class BatchPreview(BaseModel):
    items: list[BatchPreviewItem]
    lines: list["CostLine"]
    total: float


class BatchCreate(BaseModel):
    code: str | None = Field(default=None, max_length=32)
    production_date: date | None = None
    notes: str | None = None
    items: list[BatchItemIn] = Field(min_length=1)
    materials: list[BatchMaterialIn] | None = Field(
        default=None, description="Si se omite, se calcula sumando las recetas de los productos"
    )


class BatchUpdate(BaseModel):
    code: str | None = Field(default=None, max_length=32)
    production_date: date | None = None
    notes: str | None = None
    items: list[BatchItemIn] | None = Field(
        default=None, description="Reemplaza los productos del lote (solo si los materiales no se han descontado)"
    )
    materials: list[BatchMaterialIn] | None = None


class BatchItemResult(BaseModel):
    item_id: int
    produced_quantity: int = Field(ge=0)
    defective_quantity: int = Field(default=0, ge=0)


class BatchStatusChange(BaseModel):
    status: BatchStatus
    results: list[BatchItemResult] = Field(
        default_factory=list, description="Unidades producidas/defectuosas por ítem al terminar"
    )
    force: bool = Field(default=False, description="Permite stock negativo")


class ProductRef(ORM):
    id: int
    code: str
    name: str
    type: ProductType
    thumb_url: str | None
    reference_price: float | None = Field(description="Precio de venta, o el mínimo si no hay")
    min_price: float | None
    max_price: float | None


class BatchItemOut(ORM):
    id: int
    product: ProductRef
    planned_quantity: int
    produced_quantity: int | None
    defective_quantity: int
    good_quantity: int
    estimated_unit_cost: float
    allocated_cost: float
    unit_cost: float | None
    expected_revenue: float | None = Field(description="Ingreso si se vende todo al precio de referencia")
    expected_profit: float | None


class BatchOut(ORM):
    id: int
    code: str
    production_date: date
    status: BatchStatus
    materials_consumed: bool
    items: list[BatchItemOut]
    planned_quantity: int
    good_quantity: int
    total_cost: float
    expected_revenue: float = Field(description="Ingreso si se vende todo el lote (precio de venta o mínimo)")
    expected_revenue_min: float
    expected_revenue_max: float
    expected_profit: float
    expected_profit_min: float
    expected_profit_max: float
    items_without_price: int
    notes: str | None
    created_at: datetime
    updated_at: datetime


class BatchDetail(BatchOut):
    materials: list[BatchMaterialOut]


# --- Dashboard ---
class Dashboard(BaseModel):
    currency: str
    products: int
    products_in_stock: int
    finished_units: int
    stock_value_at_cost: float
    stock_value_at_sale: float
    materials: int
    materials_value: float
    low_stock_materials: list[MaterialOut]
    batches_by_status: dict[str, int]
    recent_batches: list[BatchOut]
    molds_investment: float
