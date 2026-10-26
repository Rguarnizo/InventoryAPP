from typing import Literal

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import distinct, or_, select
from sqlalchemy.exc import IntegrityError

from app.deps import CurrentUser, DbSession
from app.models import (
    Batch,
    Material,
    Mixture,
    MovementType,
    Product,
    ProductComponent,
    ProductType,
    StockMovement,
)
from app.schemas import (
    BatchOut,
    CostLine,
    MovementOut,
    Page,
    ProductComponentIn,
    ProductCost,
    ProductCreate,
    ProductDetail,
    ProductOut,
    ProductUpdate,
)
from app.services.costing import expand_recipe
from app.services.images import delete_upload, save_product_photo
from app.services.listing import paginate

router = APIRouter(prefix="/products", tags=["products"])

SORTABLE = {
    "code": Product.code,
    "name": Product.name,
    "type": Product.type,
    "category": Product.category,
    "water_weight_ml": Product.water_weight_ml,
    "mold_price": Product.mold_price,
    "min_price": Product.min_price,
    "max_price": Product.max_price,
    "sale_price": Product.sale_price,
    "stock": Product.stock,
    "created_at": Product.created_at,
    "updated_at": Product.updated_at,
}
COMPUTED = {
    "estimated_cost": lambda p: p.estimated_cost,
    "margin": lambda p: p.margin,
    "weight_g": lambda p: p.weight_g,
}


def get_or_404(db, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(404, "Producto no encontrado")
    return product


def _set_components(db, product: Product, components: list[ProductComponentIn]) -> None:
    product.components.clear()
    for comp in components:
        if comp.mixture_id is not None and db.get(Mixture, comp.mixture_id) is None:
            raise HTTPException(404, f"Mezcla {comp.mixture_id} no encontrada")
        if comp.material_id is not None and db.get(Material, comp.material_id) is None:
            raise HTTPException(404, f"Material {comp.material_id} no encontrado")
        product.components.append(ProductComponent(**comp.model_dump()))


def _commit(db, product: Product) -> Product:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ya existe un producto con ese código")
    db.refresh(product)
    return product


@router.get("", response_model=Page[ProductOut])
def list_products(
    db: DbSession,
    _: CurrentUser,
    q: str | None = None,
    type: ProductType | None = None,
    category: str | None = None,
    active: bool | None = None,
    can_be_candle: bool | None = None,
    in_stock: bool | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=500),
    sort: str | None = "code",
    order: Literal["asc", "desc"] = "asc",
):
    stmt = select(Product)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Product.name.ilike(like), Product.code.ilike(like),
                              Product.description.ilike(like), Product.category.ilike(like)))
    if type:
        stmt = stmt.where(Product.type == type)
    if category:
        stmt = stmt.where(Product.category == category)
    if active is not None:
        stmt = stmt.where(Product.active == active)
    if can_be_candle is not None:
        stmt = stmt.where(Product.can_be_candle == can_be_candle)
    if in_stock is not None:
        stmt = stmt.where(Product.stock > 0 if in_stock else Product.stock <= 0)
    return paginate(db, stmt, page=page, size=size, sort=sort, order=order,
                    sql_columns=SORTABLE, computed=COMPUTED)


@router.get("/categories", response_model=list[str])
def list_categories(db: DbSession, _: CurrentUser):
    stmt = select(distinct(Product.category)).where(Product.category.is_not(None)).order_by(Product.category)
    return db.scalars(stmt).all()


@router.post("", response_model=ProductDetail, status_code=201)
def create_product(data: ProductCreate, db: DbSession, _: CurrentUser):
    product = Product(**data.model_dump(exclude={"components"}))
    db.add(product)
    _set_components(db, product, data.components)
    if product.stock:
        db.add(StockMovement(product=product, type=MovementType.ajuste, quantity=product.stock,
                             note="Stock inicial"))
    return _commit(db, product)


@router.get("/{product_id}", response_model=ProductDetail)
def get_product(product_id: int, db: DbSession, _: CurrentUser):
    return get_or_404(db, product_id)


@router.put("/{product_id}", response_model=ProductDetail)
def update_product(product_id: int, data: ProductUpdate, db: DbSession, _: CurrentUser):
    product = get_or_404(db, product_id)
    values = data.model_dump()
    new_stock = values.pop("stock")
    for key, value in values.items():
        setattr(product, key, value)
    if new_stock is not None and new_stock != product.stock:
        db.add(StockMovement(product=product, type=MovementType.ajuste,
                             quantity=new_stock - product.stock, note="Ajuste manual"))
        product.stock = new_stock
    return _commit(db, product)


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: int, db: DbSession, _: CurrentUser):
    product = get_or_404(db, product_id)
    photo, thumb = product.photo_path, product.thumb_path
    db.delete(product)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "El producto tiene lotes registrados; desactívalo en lugar de eliminarlo")
    delete_upload(photo)
    delete_upload(thumb)


@router.put("/{product_id}/components", response_model=ProductDetail)
def replace_components(product_id: int, components: list[ProductComponentIn], db: DbSession, _: CurrentUser):
    product = get_or_404(db, product_id)
    _set_components(db, product, components)
    return _commit(db, product)


@router.post("/{product_id}/photo", response_model=ProductDetail)
def upload_photo(product_id: int, db: DbSession, _: CurrentUser, file: UploadFile = File(...)):
    product = get_or_404(db, product_id)
    photo, thumb = save_product_photo(file)
    old = (product.photo_path, product.thumb_path)
    product.photo_path, product.thumb_path = photo, thumb
    db.commit()
    for path in old:
        delete_upload(path)
    db.refresh(product)
    return product


@router.delete("/{product_id}/photo", response_model=ProductDetail)
def delete_photo(product_id: int, db: DbSession, _: CurrentUser):
    product = get_or_404(db, product_id)
    old = (product.photo_path, product.thumb_path)
    product.photo_path = product.thumb_path = None
    db.commit()
    for path in old:
        delete_upload(path)
    db.refresh(product)
    return product


class CostRequest(BaseModel):
    quantity: int = Field(default=1, gt=0)
    mixture_overrides: dict[int, int] = Field(default_factory=dict)


@router.post("/{product_id}/cost", response_model=ProductCost)
def cost_preview(product_id: int, data: CostRequest, db: DbSession, _: CurrentUser):
    """Desglose de materiales y costo para producir `quantity` unidades (sin guardar nada)."""
    product = get_or_404(db, product_id)
    needs = expand_recipe(db, product, data.quantity, data.mixture_overrides)
    lines = [CostLine(material=n.material, quantity=n.quantity, unit_cost=n.material.unit_cost, cost=n.cost)
             for n in needs]
    total = sum(line.cost for line in lines)
    return ProductCost(product_id=product.id, quantity=data.quantity, mixture_overrides=data.mixture_overrides,
                       lines=lines, total=total, unit_cost=total / data.quantity)


@router.get("/{product_id}/batches", response_model=list[BatchOut])
def product_batches(product_id: int, db: DbSession, _: CurrentUser):
    get_or_404(db, product_id)
    stmt = select(Batch).where(Batch.product_id == product_id).order_by(Batch.production_date.desc(), Batch.id.desc())
    return db.scalars(stmt).all()


@router.get("/{product_id}/movements", response_model=list[MovementOut])
def product_movements(product_id: int, db: DbSession, _: CurrentUser, limit: int = Query(100, le=1000)):
    get_or_404(db, product_id)
    stmt = (select(StockMovement).where(StockMovement.product_id == product_id)
            .order_by(StockMovement.created_at.desc(), StockMovement.id.desc()).limit(limit))
    return db.scalars(stmt).all()


class StockAdjustProduct(BaseModel):
    type: Literal["venta", "ajuste"] = "venta"
    quantity: int = Field(description="Venta: unidades vendidas (positivo). Ajuste: positivo o negativo")
    note: str | None = None


@router.post("/{product_id}/adjust", response_model=ProductDetail)
def adjust_product_stock(product_id: int, data: StockAdjustProduct, db: DbSession, _: CurrentUser):
    product = get_or_404(db, product_id)
    delta = -abs(data.quantity) if data.type == "venta" else data.quantity
    if product.stock + delta < 0:
        raise HTTPException(409, "No hay suficiente stock del producto")
    product.stock += delta
    db.add(StockMovement(product=product, type=MovementType(data.type), quantity=delta, note=data.note))
    return _commit(db, product)
