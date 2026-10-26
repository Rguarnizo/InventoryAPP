from collections.abc import Callable
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session


def paginate(
    db: Session,
    stmt: Select,
    *,
    page: int,
    size: int,
    sort: str | None,
    order: str,
    sql_columns: dict[str, Any],
    computed: dict[str, Callable[[Any], Any]] | None = None,
) -> dict:
    """Pagina y ordena. Las columnas SQL se ordenan en la BD; las calculadas en memoria."""
    computed = computed or {}
    if sort and sort not in sql_columns and sort not in computed:
        raise HTTPException(400, f"No se puede ordenar por '{sort}'")
    descending = order == "desc"

    if sort in computed:
        rows = list(db.scalars(stmt).unique())
        key = computed[sort]
        present = [r for r in rows if key(r) is not None]
        missing = [r for r in rows if key(r) is None]
        present.sort(key=key, reverse=descending)
        rows = present + missing
        return {
            "items": rows[(page - 1) * size : page * size],
            "total": len(rows),
            "page": page,
            "size": size,
        }

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    if sort:
        col = sql_columns[sort]
        stmt = stmt.order_by(col.desc().nulls_last() if descending else col.asc().nulls_last())
    items = list(db.scalars(stmt.offset((page - 1) * size).limit(size)).unique())
    return {"items": items, "total": total, "page": page, "size": size}
