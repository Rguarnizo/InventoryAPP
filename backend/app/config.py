from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://luci:luci@db:5432/luci"
    jwt_secret: str = "change-me"
    jwt_expire_minutes: int = 60 * 24 * 7
    admin_username: str = "admin"
    admin_password: str = "admin"
    currency: str = "COP"
    upload_dir: Path = Path("/app/uploads")
    max_upload_mb: int = 10
    seed_initial_data: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
