from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import knowledge, learning, runs, security, speech, ui, ws
from backend.config import Settings, get_settings
from backend.state.redis_store import create_redis_client


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
    # Browsers reject `allow_origins=["*"]` together with credentials, so the
    # dev origins are listed explicitly. Override with CORS_ORIGINS in .env.
    settings = get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(runs.router)
    app.include_router(ui.router)
    app.include_router(ws.router)
    app.include_router(knowledge.router)
    app.include_router(security.router)
    app.include_router(learning.router)
    app.include_router(speech.router)

    @app.get("/health")
    async def health():
        settings: Settings = app.state.settings
        redis_ok = False
        try:
            redis_ok = await app.state.redis.ping()
        except Exception:
            pass
        return {
            "status": "ok" if redis_ok else "degraded",
            "redis": redis_ok,
            "stub_mode": settings.stub_mode,
            "llm_provider": settings.llm_provider,
            "llm_configured": settings.llm_configured(),
        }

    return app


app = create_app()
