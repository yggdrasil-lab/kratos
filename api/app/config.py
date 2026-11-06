"""Application settings, read from the environment with the KRATOS_ prefix."""

from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="KRATOS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://kratos:kratos@localhost:5432/kratos"
    environment: str = "development"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173"
    mcp_token: str | None = None
    llm_base_url: str = "http://muninn:4000/v1"
    llm_api_key: str = "sk-muninn-insecure-master-key"
    llm_model: str = "compress"
    jev_model: str = "jev-decision"
    discord_webhook_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "KRATOS_DISCORD_WEBHOOK_URL",
            "DISCORD_HEALTH_WEBHOOK_URL",
            "DISCORD_WEBHOOK_URL",
        ),
    )
    discord_bot_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("KRATOS_DISCORD_BOT_TOKEN", "DISCORD_BOT_TOKEN"),
    )
    discord_health_channel_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "KRATOS_DISCORD_HEALTH_CHANNEL_ID", "DISCORD_HEALTH_CHANNEL_ID"
        ),
    )
    discord_user_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("KRATOS_DISCORD_USER_ID", "DISCORD_USER_ID"),
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
