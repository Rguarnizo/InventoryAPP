from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.deps import CurrentUser, DbSession
from app.models import Batch, BatchStatus, Material, Product
from app.schemas import BatchCreate, BatchDetail, BatchOut, BatchStatusChange, BatchUpdate, Page
from app.services.batches import change_status, next_batch_code, set_batch_materials
from app.services.costing import expand_recipe
from app.services.listing import paginate

router = APIRouter(prefix="/batches", tags=["batches"])

SORTABLE = {
    "code": Batch.code,
    "production_date": Batch.production_date,
    "planned_quantity": Batch.planned_quantity,
    "produced_quantity": Batch.produced_quantity,
    "defective_quantity": Batch.defective_quantity,
    "status": Batch.status,
    "product": Product.name,
    "created_at": Batch.created_at,
}
COMPUTED = {
    "total_cost": lambda b: b.total_cost,
    "unit_cost": lambda b: b.unit_cost,
    "good_quantity": lambda b: b.good_quantity,
}


def get_or_404(db, batch_id: int) -> Batch:
    batch = db.get(Batch, batch_id)
    if batch is None:
        raise HTTPException(404, "Lote no encontrado")
    return batch


def _materials_from_input(db, items) -> list[tuple[Material, float]]:
    result = []
    for item in items:
        material = db.get(Material, item.material_id)
        if material is None:
            raise HTTPException(404, f"Material {item.material_id} no encontrado")
        result.append((material, item.quantity))
    return result


def _commit(db, batch: Batch) -> Batch:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ya existe un lote con ese código")
    db.refresh(batch)
    return batch


@router.get("", response_model=Page[BatchOut])
def list_batches(
    db: DbSession,
    _: CurrentUser,
    q: str | None = None,
    status: BatchStatus | None = None,
    product_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=500),
    sort: str | None = "production_date",
    order: Literal["asc", "desc"] = "desc",
):
    stmt = select(Batch).join(Batch.product)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Batch.code.ilike(like), Product.name.ilike(like), Batch.notes.ilike(like)))
    if status:
        stmt = stmt.where(Batch.status == status)
    if product_id:
        stmt = stmt.where(Batch.product_id == product_id)
    if date_from:
        stmt = stmt.where(Batch.production_date >= date_from)
    if date_to:
        stmt = stmt.where(Batch.production_date <= date_to)
    return paginate(db, stmt, page=page, size=size, sort=sort, order=order,
                    sql_columns=SORTABLE, computed=COMPUTED)


@router.get("/next-code", response_model=str)
def get_next_code(db: DbSession, _: CurrentUser):
    return next_batch_code(db)


@router.post("", response_model=BatchDetail, status_code=201)
def create_batch(data: BatchCreate, db: DbSession, _: CurrentUser):
    product = db.get(Product, data.product_id)
    if product is None:
        raise HTTPException(404, "Producto no encontrado")
    production_date = data.production_date or date.today()
    batch = Batch(
        code=data.code or next_batch_code(db, production_date),
        product=product,
        production_date=production_date,
        planned_quantity=data.planned_quantity,
        notes=data.notes,
    )
    db.add(batch)
    if data.materials is not None:
        items = _materials_from_input(db, data.materials)
    else:
        items = [(n.material, n.quantity)
                 for n in expand_recipe(db, product, data.planned_quantity, data.mixture_overrides)]
    set_batch_materials(db, batch, items)
    return _commit(db, batch)


@router.get("/{batch_id}", response_model=BatchDetail)
def get_batch(batch_id: int, db: DbSession, _: CurrentUser):
    return get_or_404(db, batch_id)


@router.put("/{batch_id}", response_model=BatchDetail)
def update_batch(batch_id: int, data: BatchUpdate, db: DbSession, _: CurrentUser):
    batch = get_or_404(db, batch_id)
    values = data.model_dump(exclude_unset=True, exclude={"materials"})
    locked = batch.status in (BatchStatus.terminado, BatchStatus.cancelado)
    quantity_fields = {"planned_quantity", "produced_quantity", "defective_quantity"}
    if locked and quantity_fields & values.keys():
        raise HTTPException(409, "No se pueden cambiar cantidades de un lote terminado o cancelado")
    if data.materials is not None and batch.materials_consumed:
        raise HTTPException(409, "Los materiales ya fueron descontados; regresa el lote a 'planificado' para editarlos")
    for key, value in values.items():
        if key == "code" and not value:
            continue
        setattr(batch, key, value)
    if data.materials is not None:
        set_batch_materials(db, batch, _materials_from_input(db, data.materials))
    return _commit(db, batch)


@router.post("/{batch_id}/status", response_model=BatchDetail)
def update_status(batch_id: int, data: BatchStatusChange, db: DbSession, _: CurrentUser):
    batch = get_or_404(db, batch_id)
    change_status(db, batch, data.status, produced=data.produced_quantity,
                  defective=data.defective_quantity, force=data.force)
    return _commit(db, batch)


@router.delete("/{batch_id}", status_code=204)
def delete_batch(batch_id: int, db: DbSession, _: CurrentUser):
    batch = get_or_404(db, batch_id)
    if batch.status not in (BatchStatus.planificado, BatchStatus.cancelado):
        raise HTTPException(409, "Solo se pueden eliminar lotes planificados o cancelados")
    db.delete(batch)
    db.commit()
