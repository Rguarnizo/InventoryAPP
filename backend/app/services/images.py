import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import get_settings

PHOTO_MAX = (1600, 1600)
THUMB_MAX = (320, 320)


def save_product_photo(file: UploadFile) -> tuple[str, str]:
    """Guarda la foto (redimensionada) y su miniatura. Devuelve rutas relativas a upload_dir."""
    settings = get_settings()
    data = file.file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"La imagen supera {settings.max_upload_mb} MB")
    try:
        from io import BytesIO

        img = Image.open(BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "El archivo no es una imagen válida")

    folder = settings.upload_dir / "products"
    folder.mkdir(parents=True, exist_ok=True)
    name = uuid.uuid4().hex

    photo = img.copy()
    photo.thumbnail(PHOTO_MAX)
    photo.save(folder / f"{name}.jpg", "JPEG", quality=85, optimize=True)

    thumb = ImageOps.fit(img, THUMB_MAX)
    thumb.save(folder / f"{name}_thumb.jpg", "JPEG", quality=80, optimize=True)

    return f"products/{name}.jpg", f"products/{name}_thumb.jpg"


def delete_upload(relative: str | None) -> None:
    if not relative:
        return
    root = get_settings().upload_dir.resolve()
    path = (root / relative).resolve()
    if path.is_relative_to(root):
        Path(path).unlink(missing_ok=True)
