from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Batch, BatchMaterial, BatchStatus, Material, MovementType, StockMovement

S = BatchStatus
ALLOWED_TRANSITIONS: dict[BatchStatus, set[BatchStatus]] = {
    S.planificado: {S.en_proceso, S.terminado, S.cancelado},
    S.en_proceso: {S.planificado, S.terminado, S.cancelado},
    S.terminado: {S.cancelado},
    S.cancelado: {S.planificado},
}


def next_batch_code(db: Session, on: date | None = None) -> str:
    prefix = f"LN-{(on or date.today()).year}-"
    codes = db.scalars(select(Batch.code).where(Batch.code.like(f"{prefix}%"))).all()
    numbers = [int(c[len(prefix):]) for c in codes if c[len(prefix):].isdigit()]
    return f"{prefix}{(max(numbers, default=0) + 1):04d}"


def set_batch_materials(db: Session, batch: Batch, items: list[tuple[Material, float]]) -> None:
    batch.materials.clear()
    for material, qty in items:
        if qty > 0:
            batch.materials.append(
                BatchMaterial(material=material, quantity=qty, unit_cost=material.unit_cost)
            )


def _consume(db: Session, batch: Batch, force: bool) -> None:
    shortages = [
        {
            "material": bm.material.name,
            "required": round(bm.quantity, 2),
            "available": round(bm.material.stock, 2),
            "unit": bm.material.unit.value,
        }
        for bm in batch.materials
        if bm.material.stock < bm.quantity
    ]
    if shortages and not force:
        raise HTTPException(
            409, {"message": "Stock insuficiente de materia prima", "shortages": shortages}
        )
    for bm in batch.materials:
        # Congela el costo al momento del consumo
        bm.unit_cost = bm.material.unit_cost
        bm.material.stock -= bm.quantity
        db.add(StockMovement(material=bm.material, batch_id=batch.id, type=MovementType.consumo_lote,
                             quantity=-bm.quantity, note=f"Lote {batch.code}"))
    batch.materials_consumed = True


def _revert_consumption(db: Session, batch: Batch) -> None:
    for bm in batch.materials:
        bm.material.stock += bm.quantity
        db.add(StockMovement(material=bm.material, batch_id=batch.id, type=MovementType.reversion_lote,
                             quantity=bm.quantity, note=f"Reversión lote {batch.code}"))
    batch.materials_consumed = False


def change_status(
    db: Session,
    batch: Batch,
    new_status: BatchStatus,
    *,
    produced: int | None = None,
    defective: int | None = None,
    force: bool = False,
) -> Batch:
    old = batch.status
    if new_status == old:
        return batch
    if new_status not in ALLOWED_TRANSITIONS[old]:
        raise HTTPException(409, f"No se puede pasar de '{old.value}' a '{new_status.value}'")

    if new_status in (S.en_proceso, S.terminado) and not batch.materials_consumed:
        _consume(db, batch, force)

    if new_status == S.terminado:
        if produced is not None:
            batch.produced_quantity = produced
        elif batch.produced_quantity is None:
            batch.produced_quantity = batch.planned_quantity
        if defective is not None:
            batch.defective_quantity = defective
        if batch.defective_quantity > batch.produced_quantity:
            raise HTTPException(400, "Las unidades defectuosas no pueden superar las producidas")
        batch.product.stock += batch.good_quantity
        db.add(StockMovement(product=batch.product, batch_id=batch.id, type=MovementType.produccion,
                             quantity=batch.good_quantity, note=f"Lote {batch.code}"))

    if old == S.terminado and new_status == S.cancelado:
        if batch.product.stock < batch.good_quantity and not force:
            raise HTTPException(
                409, "El producto ya no tiene suficiente stock para revertir este lote (usa forzar)"
            )
        batch.product.stock -= batch.good_quantity
        db.add(StockMovement(product=batch.product, batch_id=batch.id, type=MovementType.reversion_lote,
                             quantity=-batch.good_quantity, note=f"Cancelación lote {batch.code}"))

    if new_status in (S.planificado, S.cancelado) and batch.materials_consumed:
        _revert_consumption(db, batch)

    batch.status = new_status
    return batch
