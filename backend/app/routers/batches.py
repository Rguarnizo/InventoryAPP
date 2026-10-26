from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.deps import CurrentUser, DbSession
from app.models import Batch, BatchItem, BatchStatus, Material, Product
from app.schemas import (
    BatchCreate,
    BatchDetail,
    BatchItemIn,
    BatchOut,
    BatchPreview,
    BatchPreviewItem,
    BatchPreviewRequest,
    BatchStatusChange,
    BatchUpdate,
    CostLine,
    Page,
)
from app.services.batches import change_status, next_batch_code, set_batch_materials
from app.services.costing import MaterialNeed, expand_recipe, merge_needs
from app.services.listing import paginate

router = APIRouter(prefix="/batches", tags=["batches"])

SORTABLE = {
    "code": Batch.code,
    "production_date": Batch.production_date,
    "status": Batch.status,
    "created_at": Batch.created_at,
}
COMPUTED = {
    "total_cost": lambda b: b.total_cost,
    "planned_quantity": lambda b: b.planned_quantity,
    "good_quantity": lambda b: b.good_quantity,
    "items": lambda b: len(b.items),
    "expected_revenue": lambda b: b.expected_revenue,
    "expected_profit": lambda b: b.expected_profit,
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


def _expand_items(db, items: list[BatchItemIn]) -> tuple[list[tuple[Product, BatchItemIn, float]], list[MaterialNeed]]:
    """Calcula materiales y costo unitario estimado de cada producto del lote."""
    expanded, groups = [], []
    for item in items:
        product = db.get(Product, item.product_id)
        if product is None:
            raise HTTPException(404, f"Producto {item.product_id} no encontrado")
        needs = expand_recipe(db, product, item.planned_quantity, item.mixture_overrides)
        expanded.append((product, item, sum(n.cost for n in needs) / item.planned_quantity))
        groups.append(needs)
    return expanded, merge_needs(groups)


def _set_items(batch: Batch, expanded: list[tuple[Product, BatchItemIn, float]]) -> None:
    batch.items.clear()
    for product, item, unit_cost in expanded:
        batch.items.append(BatchItem(product=product, planned_quantity=item.planned_quantity,
                                     estimated_unit_cost=unit_cost))


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
    stmt = select(Batch)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Batch.code.ilike(like), Batch.notes.ilike(like),
                              Batch.items.any(BatchItem.product.has(Product.name.ilike(like)))))
    if status:
        stmt = stmt.where(Batch.status == status)
    if product_id:
        stmt = stmt.where(Batch.items.any(BatchItem.product_id == product_id))
    if date_from:
        stmt = stmt.where(Batch.production_date >= date_from)
    if date_to:
        stmt = stmt.where(Batch.production_date <= date_to)
    return paginate(db, stmt, page=page, size=size, sort=sort, order=order,
                    sql_columns=SORTABLE, computed=COMPUTED)


@router.get("/next-code", response_model=str)
def get_next_code(db: DbSession, _: CurrentUser):
    return next_batch_code(db)


@router.post("/preview", response_model=BatchPreview)
def preview_batch(data: BatchPreviewRequest, db: DbSession, _: CurrentUser):
    """Materiales y costos que tendría un lote con estos productos (sin guardar nada)."""
    expanded, needs = _expand_items(db, data.items)
    lines = [CostLine(material=n.material, quantity=n.quantity, unit_cost=n.material.unit_cost, cost=n.cost)
             for n in needs]
    return BatchPreview(
        items=[BatchPreviewItem(product_id=p.id, planned_quantity=i.planned_quantity, estimated_unit_cost=c)
               for p, i, c in expanded],
        lines=lines,
        total=sum(line.cost for line in lines),
    )


@router.post("", response_model=BatchDetail, status_code=201)
def create_batch(data: BatchCreate, db: DbSession, _: CurrentUser):
    production_date = data.production_date or date.today()
    expanded, needs = _expand_items(db, data.items)
    batch = Batch(code=data.code or next_batch_code(db, production_date),
                  production_date=production_date, notes=data.notes)
    db.add(batch)
    _set_items(batch, expanded)
    if data.materials is not None:
        items = _materials_from_input(db, data.materials)
    else:
        items = [(n.material, n.quantity) for n in needs]
    set_batch_materials(db, batch, items)
    return _commit(db, batch)


@router.get("/{batch_id}", response_model=BatchDetail)
def get_batch(batch_id: int, db: DbSession, _: CurrentUser):
    return get_or_404(db, batch_id)


@router.put("/{batch_id}", response_model=BatchDetail)
def update_batch(batch_id: int, data: BatchUpdate, db: DbSession, _: CurrentUser):
    batch = get_or_404(db, batch_id)
    if (data.materials is not None or data.items is not None) and batch.materials_consumed:
        raise HTTPException(409, "Los materiales ya fueron descontados; regresa el lote a 'planificado' para editarlo")
    if data.items is not None and batch.status != BatchStatus.planificado:
        raise HTTPException(409, "Solo se pueden cambiar los productos de un lote planificado")
    if data.items is not None and not data.items:
        raise HTTPException(400, "El lote debe tener al menos un producto")
    values = data.model_dump(exclude_unset=True, exclude={"materials", "items"})
    for key, value in values.items():
        if key == "code" and not value:
            continue
        setattr(batch, key, value)
    if data.items is not None:
        expanded, _needs = _expand_items(db, data.items)
        _set_items(batch, expanded)
    if data.materials is not None:
        set_batch_materials(db, batch, _materials_from_input(db, data.materials))
    return _commit(db, batch)


@router.post("/{batch_id}/status", response_model=BatchDetail)
def update_status(batch_id: int, data: BatchStatusChange, db: DbSession, _: CurrentUser):
    batch = get_or_404(db, batch_id)
    results = {r.item_id: (r.produced_quantity, r.defective_quantity) for r in data.results}
    change_status(db, batch, data.status, results=results, force=data.force)
    return _commit(db, batch)


@router.delete("/{batch_id}", status_code=204)
def delete_batch(batch_id: int, db: DbSession, _: CurrentUser):
    batch = get_or_404(db, batch_id)
    if batch.status not in (BatchStatus.planificado, BatchStatus.cancelado):
        raise HTTPException(409, "Solo se pueden eliminar lotes planificados o cancelados")
    db.delete(batch)
    db.commit()
