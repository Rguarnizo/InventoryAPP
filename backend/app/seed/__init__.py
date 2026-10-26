import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Material, Mixture, MixtureComponent, MixtureType, Product, ProductComponent, ProductType, Unit

DATA_FILE = Path(__file__).with_name("initial_data.json")


def load_initial_data(db: Session, path: Path = DATA_FILE) -> None:
    """Carga materiales, mezclas y productos (idempotente: omite los que ya existen)."""
    data = json.loads(path.read_text(encoding="utf-8"))

    materials = {m.name: m for m in db.scalars(select(Material))}
    for item in data["materials"]:
        if item["name"] not in materials:
            materials[item["name"]] = Material(**{**item, "unit": Unit(item["unit"])})
            db.add(materials[item["name"]])
    db.flush()

    mixtures = {m.name: m for m in db.scalars(select(Mixture))}
    for item in data["mixtures"]:
        if item["name"] in mixtures:
            continue
        mixture = Mixture(name=item["name"], type=MixtureType(item["type"]), notes=item.get("notes"))
        mixture.components = [
            MixtureComponent(material=materials[c["material"]], proportion=c["proportion"])
            for c in item["components"]
        ]
        db.add(mixture)
        mixtures[item["name"]] = mixture
    db.flush()

    existing = set(db.scalars(select(Product.code)))
    created = 0
    for item in data["products"]:
        if item["code"] in existing:
            continue
        components = item.pop("components")
        product = Product(**{**item, "type": ProductType(item["type"])}, sale_price=None, stock=0)
        product.components = [
            ProductComponent(
                mixture=mixtures.get(c.get("mixture")) if c.get("mixture") else None,
                material=materials.get(c.get("material")) if c.get("material") else None,
                quantity=c["quantity"],
            )
            for c in components
        ]
        db.add(product)
        created += 1
    db.commit()
    print(f"Datos iniciales cargados: {len(data['materials'])} materiales, "
          f"{len(data['mixtures'])} mezclas, {created} productos nuevos")
