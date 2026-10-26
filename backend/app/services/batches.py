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
    results: dict[int, tuple[int, int]] | None = None,
    force: bool = False,
) -> Batch:
    """Cambia el estado del lote moviendo inventario.

    `results` es item_id → (producidas, defectuosas) y se usa al terminar; los ítems sin
    resultado se asumen producidos según lo planificado y sin defectos.
    """
    old = batch.status
    if new_status == old:
        return batch
    if new_status not in ALLOWED_TRANSITIONS[old]:
        raise HTTPException(409, f"No se puede pasar de '{old.value}' a '{new_status.value}'")

    if new_status in (S.en_proceso, S.terminado) and not batch.materials_consumed:
        _consume(db, batch, force)

    if new_status == S.terminado:
        results = results or {}
        unknown = set(results) - {i.id for i in batch.items}
        if unknown:
            raise HTTPException(400, f"Ítems que no pertenecen al lote: {sorted(unknown)}")
        for item in batch.items:
            produced, defective = results.get(
                item.id, (item.produced_quantity if item.produced_quantity is not None else item.planned_quantity,
                          item.defective_quantity or 0),
            )
            if defective > produced:
                raise HTTPException(400, f"{item.product.name}: las defectuosas no pueden superar las producidas")
            item.produced_quantity, item.defective_quantity = produced, defective
            item.product.stock += item.good_quantity
            db.add(StockMovement(product=item.product, batch_id=batch.id, type=MovementType.produccion,
                                 quantity=item.good_quantity, note=f"Lote {batch.code}"))

    if old == S.terminado and new_status == S.cancelado:
        lacking = [i.product.name for i in batch.items if i.product.stock < i.good_quantity]
        if lacking and not force:
            raise HTTPException(
                409, f"Ya no hay suficiente stock para revertir: {', '.join(lacking)} (usa forzar)"
            )
        for item in batch.items:
            item.product.stock -= item.good_quantity
            db.add(StockMovement(product=item.product, batch_id=batch.id, type=MovementType.reversion_lote,
                                 quantity=-item.good_quantity, note=f"Cancelación lote {batch.code}"))

    if new_status in (S.planificado, S.cancelado) and batch.materials_consumed:
        _revert_consumption(db, batch)

    batch.status = new_status
    return batch
