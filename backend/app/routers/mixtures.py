from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.deps import CurrentUser, DbSession
from app.models import Material, Mixture, MixtureComponent
from app.schemas import MixtureIn, MixtureOut

router = APIRouter(prefix="/mixtures", tags=["mixtures"])


def get_or_404(db, mixture_id: int) -> Mixture:
    mixture = db.get(Mixture, mixture_id)
    if mixture is None:
        raise HTTPException(404, "Mezcla no encontrada")
    return mixture


def _apply(db, mixture: Mixture, data: MixtureIn) -> None:
    mixture.name = data.name
    mixture.type = data.type
    mixture.notes = data.notes
    mixture.components.clear()
    for comp in data.components:
        if db.get(Material, comp.material_id) is None:
            raise HTTPException(404, f"Material {comp.material_id} no encontrado")
        mixture.components.append(MixtureComponent(material_id=comp.material_id, proportion=comp.proportion))


def _commit(db, mixture: Mixture) -> Mixture:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ya existe una mezcla con ese nombre")
    db.refresh(mixture)
    return mixture


@router.get("", response_model=list[MixtureOut])
def list_mixtures(db: DbSession, _: CurrentUser):
    return db.scalars(select(Mixture).order_by(Mixture.type, Mixture.name)).all()


@router.post("", response_model=MixtureOut, status_code=201)
def create_mixture(data: MixtureIn, db: DbSession, _: CurrentUser):
    mixture = Mixture(name=data.name)
    db.add(mixture)
    _apply(db, mixture, data)
    return _commit(db, mixture)


@router.get("/{mixture_id}", response_model=MixtureOut)
def get_mixture(mixture_id: int, db: DbSession, _: CurrentUser):
    return get_or_404(db, mixture_id)


@router.put("/{mixture_id}", response_model=MixtureOut)
def update_mixture(mixture_id: int, data: MixtureIn, db: DbSession, _: CurrentUser):
    mixture = get_or_404(db, mixture_id)
    _apply(db, mixture, data)
    return _commit(db, mixture)


@router.delete("/{mixture_id}", status_code=204)
def delete_mixture(mixture_id: int, db: DbSession, _: CurrentUser):
    db.delete(get_or_404(db, mixture_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "La mezcla se usa en recetas de productos; no se puede eliminar")
