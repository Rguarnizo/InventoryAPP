from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.deps import CurrentUser, DbSession
from app.models import Material, MovementType, StockMovement
from app.schemas import MaterialCreate, MaterialOut, MaterialUpdate, MovementOut, Page, StockAdjust
from app.services.listing import paginate

router = APIRouter(prefix="/materials", tags=["materials"])

SORTABLE = {
    "name": Material.name,
    "unit": Material.unit,
    "package_quantity": Material.package_quantity,
    "package_price": Material.package_price,
    "stock": Material.stock,
    "min_stock": Material.min_stock,
    "supplier": Material.supplier,
    "updated_at": Material.updated_at,
}
COMPUTED = {"unit_cost": lambda m: m.unit_cost, "low_stock": lambda m: m.low_stock}


def get_or_404(db, material_id: int) -> Material:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(404, "Material no encontrado")
    return material


@router.get("", response_model=Page[MaterialOut])
def list_materials(
    db: DbSession,
    _: CurrentUser,
    q: str | None = None,
    low_stock: bool | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    sort: str | None = "name",
    order: Literal["asc", "desc"] = "asc",
):
    stmt = select(Material)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Material.name.ilike(like), Material.supplier.ilike(like)))
    if low_stock is not None:
        cond = Material.stock < Material.min_stock
        stmt = stmt.where(cond if low_stock else ~cond)
    return paginate(db, stmt, page=page, size=size, sort=sort, order=order,
                    sql_columns=SORTABLE, computed=COMPUTED)


@router.post("", response_model=MaterialOut, status_code=201)
def create_material(data: MaterialCreate, db: DbSession, _: CurrentUser):
    material = Material(**data.model_dump())
    db.add(material)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ya existe un material con ese nombre")
    if material.stock:
        db.add(StockMovement(material=material, type=MovementType.ajuste,
                             quantity=material.stock, note="Stock inicial"))
    db.commit()
    return material


@router.get("/{material_id}", response_model=MaterialOut)
def get_material(material_id: int, db: DbSession, _: CurrentUser):
    return get_or_404(db, material_id)


@router.put("/{material_id}", response_model=MaterialOut)
def update_material(material_id: int, data: MaterialUpdate, db: DbSession, _: CurrentUser):
    material = get_or_404(db, material_id)
    for key, value in data.model_dump().items():
        setattr(material, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ya existe un material con ese nombre")
    return material


@router.delete("/{material_id}", status_code=204)
def delete_material(material_id: int, db: DbSession, _: CurrentUser):
    material = get_or_404(db, material_id)
    db.delete(material)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "El material se usa en mezclas, recetas o lotes; no se puede eliminar")


@router.post("/{material_id}/adjust", response_model=MaterialOut)
def adjust_stock(material_id: int, data: StockAdjust, db: DbSession, _: CurrentUser):
    material = get_or_404(db, material_id)
    material.stock += data.quantity
    if data.package_price is not None:
        material.package_price = data.package_price
    db.add(StockMovement(material=material, type=data.type, quantity=data.quantity, note=data.note))
    db.commit()
    return material


@router.get("/{material_id}/movements", response_model=list[MovementOut])
def material_movements(material_id: int, db: DbSession, _: CurrentUser, limit: int = Query(100, le=1000)):
    get_or_404(db, material_id)
    stmt = (select(StockMovement).where(StockMovement.material_id == material_id)
            .order_by(StockMovement.created_at.desc(), StockMovement.id.desc()).limit(limit))
    return db.scalars(stmt).all()
