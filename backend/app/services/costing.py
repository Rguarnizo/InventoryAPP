from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Material, Mixture, Product


@dataclass
class MaterialNeed:
    material: Material
    quantity: float

    @property
    def cost(self) -> float:
        return self.quantity * self.material.unit_cost


def expand_recipe(
    db: Session, product: Product, quantity: int, mixture_overrides: dict[int, int] | None = None
) -> list[MaterialNeed]:
    """Convierte la receta del producto × cantidad en cantidades de cada material.

    Las mezclas se reparten según sus proporciones. `mixture_overrides` permite usar otra
    mezcla en un componente (component_id → mixture_id), p.ej. cera de palma en vez de soya.
    """
    overrides = mixture_overrides or {}
    needs: dict[int, MaterialNeed] = {}

    def add(material: Material, qty: float) -> None:
        if material.id in needs:
            needs[material.id].quantity += qty
        else:
            needs[material.id] = MaterialNeed(material, qty)

    for comp in product.components:
        total = comp.quantity * quantity
        if comp.mixture_id is None:
            add(comp.material, total)
            continue
        mixture = comp.mixture
        if comp.id in overrides:
            mixture = db.get(Mixture, overrides[comp.id])
            if mixture is None:
                raise HTTPException(404, f"Mezcla {overrides[comp.id]} no encontrada")
        proportion_sum = sum(mc.proportion for mc in mixture.components)
        for mc in mixture.components:
            add(mc.material, total * mc.proportion / proportion_sum)

    return list(needs.values())


def merge_needs(groups: list[list[MaterialNeed]]) -> list[MaterialNeed]:
    """Suma las necesidades de material de varios productos."""
    merged: dict[int, MaterialNeed] = {}
    for needs in groups:
        for n in needs:
            if n.material.id in merged:
                merged[n.material.id].quantity += n.quantity
            else:
                merged[n.material.id] = MaterialNeed(n.material, n.quantity)
    return list(merged.values())
