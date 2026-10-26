"""Se ejecuta al iniciar el contenedor: crea el usuario admin y carga datos iniciales si la BD está vacía."""
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Material, Product, User
from app.security import hash_password


def ensure_admin(db) -> None:
    settings = get_settings()
    if db.scalar(select(User).where(User.username == settings.admin_username)) is None:
        db.add(User(username=settings.admin_username, password_hash=hash_password(settings.admin_password)))
        db.commit()
        print(f"Usuario '{settings.admin_username}' creado")


def main() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        ensure_admin(db)
        empty = db.scalar(select(Product.id).limit(1)) is None and db.scalar(select(Material.id).limit(1)) is None
        if settings.seed_initial_data and empty:
            from app.seed import load_initial_data

            load_initial_data(db)


if __name__ == "__main__":
    main()
