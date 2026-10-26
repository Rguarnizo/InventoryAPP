from fastapi import APIRouter
from sqlalchemy import func, select

from app.config import get_settings
from app.deps import CurrentUser, DbSession
from app.models import Batch, Material, Product
from app.schemas import Dashboard

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=Dashboard)
def dashboard(db: DbSession, _: CurrentUser):
    products = db.scalars(select(Product).where(Product.active.is_(True))).all()
    materials = db.scalars(select(Material).order_by(Material.name)).all()
    by_status = dict(db.execute(select(Batch.status, func.count()).group_by(Batch.status)).all())
    recent = db.scalars(select(Batch).order_by(Batch.created_at.desc(), Batch.id.desc()).limit(8)).all()
    return Dashboard(
        currency=get_settings().currency,
        products=len(products),
        products_in_stock=sum(1 for p in products if p.stock > 0),
        finished_units=sum(p.stock for p in products),
        stock_value_at_cost=sum(p.stock * p.estimated_cost for p in products),
        stock_value_at_sale=sum(p.stock * (p.reference_price or 0) for p in products),
        materials=len(materials),
        materials_value=sum(max(m.stock, 0) * m.unit_cost for m in materials),
        low_stock_materials=[m for m in materials if m.low_stock],
        batches_by_status={s.value: n for s, n in by_status.items()},
        recent_batches=recent,
        molds_investment=sum((p.mold_price or 0) * (p.mold_count or 0) for p in products),
    )
