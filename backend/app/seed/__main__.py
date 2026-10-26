from app.db import SessionLocal
from app.seed import load_initial_data

with SessionLocal() as db:
    load_initial_data(db)
