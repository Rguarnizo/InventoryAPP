import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(cls, name=name, values_callable=lambda e: [m.value for m in e])


class Unit(str, enum.Enum):
    g = "g"
    ml = "ml"
    unidad = "unidad"


class MixtureType(str, enum.Enum):
    concreto = "concreto"
    cera = "cera"
    otro = "otro"


class ProductType(str, enum.Enum):
    concreto = "concreto"
    vela = "vela"
    concreto_con_vela = "concreto_con_vela"
    otro = "otro"


class BatchStatus(str, enum.Enum):
    planificado = "planificado"
    en_proceso = "en_proceso"
    terminado = "terminado"
    cancelado = "cancelado"


class MovementType(str, enum.Enum):
    compra = "compra"
    ajuste = "ajuste"
    consumo_lote = "consumo_lote"
    reversion_lote = "reversion_lote"
    produccion = "produccion"
    venta = "venta"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))


class Material(Base, TimestampMixin):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    unit: Mapped[Unit] = mapped_column(_enum(Unit, "unit"), default=Unit.g)
    package_quantity: Mapped[float] = mapped_column(Float, default=1)
    package_price: Mapped[float] = mapped_column(Float, default=0)
    stock: Mapped[float] = mapped_column(Float, default=0)
    min_stock: Mapped[float] = mapped_column(Float, default=0)
    supplier: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (CheckConstraint("package_quantity > 0", name="ck_material_package_qty"),)

    @property
    def unit_cost(self) -> float:
        return self.package_price / self.package_quantity if self.package_quantity else 0.0

    @property
    def low_stock(self) -> bool:
        return self.stock < self.min_stock


class Mixture(Base, TimestampMixin):
    __tablename__ = "mixtures"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    type: Mapped[MixtureType] = mapped_column(_enum(MixtureType, "mixture_type"), default=MixtureType.otro)
    notes: Mapped[str | None] = mapped_column(Text)

    components: Mapped[list["MixtureComponent"]] = relationship(
        back_populates="mixture", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def cost_per_unit(self) -> float:
        """Costo por gramo (o unidad base) de la mezcla, ponderado por proporción."""
        total = sum(c.proportion for c in self.components)
        if not total:
            return 0.0
        return sum(c.proportion * c.material.unit_cost for c in self.components) / total


class MixtureComponent(Base):
    __tablename__ = "mixture_components"

    id: Mapped[int] = mapped_column(primary_key=True)
    mixture_id: Mapped[int] = mapped_column(ForeignKey("mixtures.id", ondelete="CASCADE"))
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="RESTRICT"))
    proportion: Mapped[float] = mapped_column(Float)

    mixture: Mapped[Mixture] = relationship(back_populates="components")
    material: Mapped[Material] = relationship(lazy="joined")

    __table_args__ = (CheckConstraint("proportion > 0", name="ck_mixture_component_proportion"),)


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    type: Mapped[ProductType] = mapped_column(_enum(ProductType, "product_type"), default=ProductType.otro)
    category: Mapped[str | None] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(Text)
    photo_path: Mapped[str | None] = mapped_column(String(255))
    thumb_path: Mapped[str | None] = mapped_column(String(255))
    can_be_candle: Mapped[bool] = mapped_column(Boolean, default=False)
    water_weight_ml: Mapped[float | None] = mapped_column(Float)
    mold_price: Mapped[float | None] = mapped_column(Float)
    mold_count: Mapped[int] = mapped_column(Integer, default=1)
    min_price: Mapped[float | None] = mapped_column(Float)
    max_price: Mapped[float | None] = mapped_column(Float)
    sale_price: Mapped[float | None] = mapped_column(Float)
    stock: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    components: Mapped[list["ProductComponent"]] = relationship(
        back_populates="product", cascade="all, delete-orphan", lazy="selectin",
        order_by="ProductComponent.id",
    )

    @property
    def photo_url(self) -> str | None:
        return f"/uploads/{self.photo_path}" if self.photo_path else None

    @property
    def thumb_url(self) -> str | None:
        return f"/uploads/{self.thumb_path}" if self.thumb_path else None

    @property
    def weight_g(self) -> float | None:
        weights = [c.quantity for c in self.components if c.mixture_id is not None]
        return sum(weights) if weights else None

    @property
    def estimated_cost(self) -> float:
        return sum(c.cost for c in self.components)

    @property
    def reference_price(self) -> float | None:
        return self.sale_price or self.min_price

    @property
    def margin(self) -> float | None:
        price = self.reference_price
        if not price:
            return None
        return (price - self.estimated_cost) / price


class ProductComponent(Base):
    """Una línea de la receta: una mezcla con su peso por unidad, o un material con su cantidad."""

    __tablename__ = "product_components"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    mixture_id: Mapped[int | None] = mapped_column(ForeignKey("mixtures.id", ondelete="RESTRICT"))
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id", ondelete="RESTRICT"))
    quantity: Mapped[float] = mapped_column(Float)

    product: Mapped[Product] = relationship(back_populates="components")
    mixture: Mapped[Mixture | None] = relationship(lazy="joined")
    material: Mapped[Material | None] = relationship(lazy="joined")

    __table_args__ = (
        CheckConstraint(
            "(mixture_id IS NULL) <> (material_id IS NULL)", name="ck_product_component_one_source"
        ),
        CheckConstraint("quantity > 0", name="ck_product_component_quantity"),
    )

    @property
    def unit_cost(self) -> float:
        if self.mixture is not None:
            return self.mixture.cost_per_unit
        return self.material.unit_cost if self.material is not None else 0.0

    @property
    def cost(self) -> float:
        return self.quantity * self.unit_cost


class Batch(Base, TimestampMixin):
    __tablename__ = "batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    production_date: Mapped[date] = mapped_column(Date, server_default=func.current_date())
    status: Mapped[BatchStatus] = mapped_column(
        _enum(BatchStatus, "batch_status"), default=BatchStatus.planificado
    )
    materials_consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)

    items: Mapped[list["BatchItem"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan", lazy="selectin",
        order_by="BatchItem.id",
    )
    materials: Mapped[list["BatchMaterial"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan", lazy="selectin",
        order_by="BatchMaterial.id",
    )

    @property
    def total_cost(self) -> float:
        return sum(m.quantity * m.unit_cost for m in self.materials)

    @property
    def planned_quantity(self) -> int:
        return sum(i.planned_quantity for i in self.items)

    @property
    def good_quantity(self) -> int:
        return sum(i.good_quantity for i in self.items)

    def _revenue(self, price: str) -> float:
        return sum(r for i in self.items if (r := i.revenue(price)) is not None)

    @property
    def expected_revenue(self) -> float:
        return self._revenue("reference")

    @property
    def expected_revenue_min(self) -> float:
        return self._revenue("min")

    @property
    def expected_revenue_max(self) -> float:
        return self._revenue("max")

    @property
    def expected_profit(self) -> float:
        return self.expected_revenue - self.total_cost

    @property
    def expected_profit_min(self) -> float:
        return self.expected_revenue_min - self.total_cost

    @property
    def expected_profit_max(self) -> float:
        return self.expected_revenue_max - self.total_cost

    @property
    def items_without_price(self) -> int:
        return sum(1 for i in self.items if i.product.reference_price is None)

    def cost_share(self, item: "BatchItem") -> float:
        """Fracción del costo del lote que corresponde a un ítem.

        Se reparte según el costo estimado de la receta (unidades × costo unitario estimado);
        si no hay estimación, según las unidades planificadas.
        """
        weights = [i.planned_quantity * (i.estimated_unit_cost or 0) for i in self.items]
        if sum(weights) <= 0:
            weights = [i.planned_quantity for i in self.items]
        total = sum(weights)
        return weights[self.items.index(item)] / total if total else 0.0


class BatchItem(Base):
    """Un producto (figura o vela) dentro de un lote."""

    __tablename__ = "batch_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"))
    planned_quantity: Mapped[int] = mapped_column(Integer)
    produced_quantity: Mapped[int | None] = mapped_column(Integer)
    defective_quantity: Mapped[int] = mapped_column(Integer, default=0)
    # Costo unitario estimado por receta al crear el lote; se usa para repartir el costo real
    estimated_unit_cost: Mapped[float] = mapped_column(Float, default=0)

    batch: Mapped[Batch] = relationship(back_populates="items")
    product: Mapped[Product] = relationship(lazy="joined")

    __table_args__ = (CheckConstraint("planned_quantity > 0", name="ck_batch_item_planned"),)

    @property
    def good_quantity(self) -> int:
        produced = self.produced_quantity if self.produced_quantity is not None else self.planned_quantity
        return max(produced - (self.defective_quantity or 0), 0)

    @property
    def allocated_cost(self) -> float:
        return self.batch.total_cost * self.batch.cost_share(self)

    def revenue(self, price: str = "reference") -> float | None:
        """Ingreso si se venden todas las unidades buenas (o las planificadas si no ha terminado)."""
        value = {
            "reference": self.product.reference_price,
            "min": self.product.min_price or self.product.reference_price,
            "max": self.product.max_price or self.product.reference_price,
        }[price]
        return self.good_quantity * value if value is not None else None

    @property
    def expected_revenue(self) -> float | None:
        return self.revenue()

    @property
    def expected_profit(self) -> float | None:
        revenue = self.revenue()
        return revenue - self.allocated_cost if revenue is not None else None

    @property
    def unit_cost(self) -> float | None:
        good = self.good_quantity
        return self.allocated_cost / good if good else None


class BatchMaterial(Base):
    __tablename__ = "batch_materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id", ondelete="CASCADE"))
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="RESTRICT"))
    quantity: Mapped[float] = mapped_column(Float)
    unit_cost: Mapped[float] = mapped_column(Float)

    batch: Mapped[Batch] = relationship(back_populates="materials")
    material: Mapped[Material] = relationship(lazy="joined")


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"))
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.id", ondelete="SET NULL"))
    type: Mapped[MovementType] = mapped_column(_enum(MovementType, "movement_type"))
    quantity: Mapped[float] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    material: Mapped[Material | None] = relationship(lazy="joined")
    product: Mapped[Product | None] = relationship(lazy="joined")
