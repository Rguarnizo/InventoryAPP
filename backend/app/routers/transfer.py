"""Importación y exportación CSV (compatible con LibreOffice/Excel)."""
import csv
import io
from collections.abc import Iterable

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.models import Batch, Material, MovementType, Product, ProductType, StockMovement, Unit

router = APIRouter(tags=["import/export"])

PRODUCT_FIELDS = ["code", "name", "type", "category", "description", "can_be_candle", "water_weight_ml",
                  "mold_price", "mold_count", "min_price", "max_price", "sale_price", "stock", "active"]
MATERIAL_FIELDS = ["name", "unit", "package_quantity", "package_price", "stock", "min_stock", "supplier", "notes"]


class ImportResult(BaseModel):
    created: int
    updated: int
    errors: list[str]


def _csv_response(filename: str, header: list[str], rows: Iterable[list]) -> StreamingResponse:
    buf = io.StringIO()
    buf.write("﻿")  # BOM para que Excel detecte UTF-8
    writer = csv.writer(buf)
    writer.writerow(header)
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _read_csv(file: UploadFile) -> list[dict[str, str]]:
    text = file.file.read().decode("utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=",;\t")
    except (csv.Error, IndexError):
        dialect = csv.excel
    return [{(k or "").strip(): (v or "").strip() for k, v in row.items()}
            for row in csv.DictReader(io.StringIO(text), dialect=dialect)]


def parse_number(value: str) -> float | None:
    """Acepta 41900, 41.900, 41,900, $41.900,50, 1.5 …"""
    v = value.replace("$", "").replace(" ", "").strip()
    if not v:
        return None
    if "," in v and "." in v:
        decimal = "," if v.rfind(",") > v.rfind(".") else "."
        thousands = "." if decimal == "," else ","
        v = v.replace(thousands, "").replace(decimal, ".")
    elif "," in v:
        head, _, tail = v.rpartition(",")
        v = v.replace(",", "") if len(tail) == 3 else head.replace(",", "") + "." + tail
    elif v.count(".") > 1 or (v.count(".") == 1 and len(v.rpartition(".")[2]) == 3 and len(v) > 4):
        v = v.replace(".", "")
    return float(v)


def parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "si", "sí", "yes", "x", "verdadero"}


def _num(row: dict, key: str):
    return parse_number(row[key]) if row.get(key) else None


@router.get("/export/products")
def export_products(db: DbSession, _: CurrentUser):
    products = db.scalars(select(Product).order_by(Product.code)).all()
    rows = ([*(getattr(p, f).value if f == "type" else getattr(p, f) for f in PRODUCT_FIELDS),
             round(p.estimated_cost, 2)] for p in products)
    return _csv_response("productos.csv", [*PRODUCT_FIELDS, "estimated_cost"], rows)


@router.get("/export/materials")
def export_materials(db: DbSession, _: CurrentUser):
    materials = db.scalars(select(Material).order_by(Material.name)).all()
    rows = ([*(getattr(m, f).value if f == "unit" else getattr(m, f) for f in MATERIAL_FIELDS),
             round(m.unit_cost, 4)] for m in materials)
    return _csv_response("materia_prima.csv", [*MATERIAL_FIELDS, "unit_cost"], rows)


@router.get("/export/batches")
def export_batches(db: DbSession, _: CurrentUser):
    """Una fila por producto de cada lote, con su parte del costo."""
    batches = db.scalars(select(Batch).order_by(Batch.production_date, Batch.id)).all()
    header = ["code", "production_date", "status", "product_code", "product", "planned_quantity",
              "produced_quantity", "defective_quantity", "good_quantity", "allocated_cost", "unit_cost",
              "batch_total_cost", "notes"]
    rows = ([b.code, b.production_date.isoformat(), b.status.value, i.product.code, i.product.name,
             i.planned_quantity, i.produced_quantity, i.defective_quantity, i.good_quantity,
             round(i.allocated_cost, 2), round(i.unit_cost, 2) if i.unit_cost is not None else "",
             round(b.total_cost, 2), b.notes or ""]
            for b in batches for i in b.items)
    return _csv_response("lotes.csv", header, rows)


def _import_rows(db, file: UploadFile, apply_row) -> ImportResult:
    """Aplica cada fila en un savepoint: una fila con errores no afecta a las demás."""
    created = updated = 0
    errors: list[str] = []
    for i, row in enumerate(_read_csv(file), start=2):
        try:
            with db.begin_nested():
                is_new = apply_row(db, row)
        except (ValueError, KeyError) as exc:
            errors.append(f"Fila {i}: {exc}")
            continue
        created += is_new
        updated += not is_new
    db.commit()
    return ImportResult(created=created, updated=updated, errors=errors)


def _apply_product_row(db, row: dict[str, str]) -> bool:
    code, name = row.get("code"), row.get("name")
    if not code:
        raise ValueError("falta 'code'")
    product = db.scalar(select(Product).where(Product.code == code))
    is_new = product is None
    if is_new:
        if not name:
            raise ValueError("falta 'name'")
        product = Product(code=code, name=name, stock=0)
        db.add(product)
    if name:
        product.name = name
    if row.get("type"):
        product.type = ProductType(row["type"])
    for key in ("category", "description"):
        if key in row:
            setattr(product, key, row[key] or None)
    for key in ("water_weight_ml", "mold_price", "min_price", "max_price", "sale_price"):
        if key in row:
            setattr(product, key, _num(row, key))
    if row.get("mold_count"):
        product.mold_count = int(parse_number(row["mold_count"]))
    for key in ("can_be_candle", "active"):
        if row.get(key):
            setattr(product, key, parse_bool(row[key]))
    if row.get("stock"):
        new_stock = int(parse_number(row["stock"]))
        delta = new_stock - (product.stock or 0)
        if delta:
            product.stock = new_stock
            db.add(StockMovement(product=product, type=MovementType.ajuste, quantity=delta,
                                 note="Importación CSV"))
    db.flush()
    return is_new


def _apply_material_row(db, row: dict[str, str]) -> bool:
    name = row.get("name")
    if not name:
        raise ValueError("falta 'name'")
    material = db.scalar(select(Material).where(Material.name == name))
    is_new = material is None
    if is_new:
        if not row.get("package_quantity"):
            raise ValueError("falta 'package_quantity'")
        material = Material(name=name, stock=0, package_price=0, min_stock=0)
        db.add(material)
    if row.get("unit"):
        material.unit = Unit(row["unit"])
    for key in ("package_quantity", "package_price", "min_stock"):
        if row.get(key):
            setattr(material, key, parse_number(row[key]))
    if material.package_quantity is None or material.package_quantity <= 0:
        raise ValueError("'package_quantity' debe ser mayor que 0")
    for key in ("supplier", "notes"):
        if key in row:
            setattr(material, key, row[key] or None)
    if row.get("stock"):
        new_stock = parse_number(row["stock"])
        delta = new_stock - (material.stock or 0)
        if delta:
            material.stock = new_stock
            db.add(StockMovement(material=material, type=MovementType.ajuste, quantity=delta,
                                 note="Importación CSV"))
    db.flush()
    return is_new


@router.post("/import/products", response_model=ImportResult)
def import_products(db: DbSession, _: CurrentUser, file: UploadFile = File(...)):
    """Crea o actualiza productos por `code`. No modifica recetas ni fotos."""
    return _import_rows(db, file, _apply_product_row)


@router.post("/import/materials", response_model=ImportResult)
def import_materials(db: DbSession, _: CurrentUser, file: UploadFile = File(...)):
    """Crea o actualiza materias primas por `name`."""
    return _import_rows(db, file, _apply_material_row)
