import logging
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import runs, ws
from backend.config import Settings, get_settings
from backend.state.redis_store import create_redis_client

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    app.state.redis = await create_redis_client(settings)
    try:
        yield
    finally:
        await app.state.redis.aclose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="SENTINEL Bug Detection API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(runs.router)
    app.include_router(ws.router)

    @app.get("/health")
    async def health():
        settings: Settings = app.state.settings
        redis_ok = False
        try:
            redis_ok = await app.state.redis.ping()
        except Exception:
            logger.warning("Redis health check failed", exc_info=True)
        return {
            "status": "ok" if redis_ok else "degraded",
            "redis": redis_ok,
            "stub_mode": settings.stub_mode,
            "llm_provider": settings.llm_provider,
            "llm_configured": settings.llm_configured(),
        }

    return app


app = create_app()
