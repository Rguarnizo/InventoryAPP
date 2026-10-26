from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routers import auth, batches, dashboard, materials, mixtures, products, transfer

settings = get_settings()
settings.upload_dir.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="Luci Notturne – Inventario",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

api = APIRouter(prefix="/api")
for module in (auth, dashboard, materials, mixtures, products, batches, transfer):
    api.include_router(module.router)


@api.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}


@api.get("/config", tags=["meta"])
def public_config():
    return {"currency": settings.currency}


app.include_router(api)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
