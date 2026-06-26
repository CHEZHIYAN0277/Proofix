#  Autonomous Multi-Agent Bug Detection Backend

FastAPI + LangGraph pipeline for autonomous bug detection, repair, validation, and GitHub PR creation.

## Quick Start

```bash
docker compose up -d
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m spacy download en_core_web_sm
cp .env.example .env
uvicorn backend.main:app --reload
```

## API

- `POST /runs` — start a pipeline run
- `GET /runs/{run_id}` — run status
- `GET /runs/{run_id}/sig` — Semantic Intent Graph
- `GET /runs/{run_id}/events` — event history
- `WS /ws/runs/{run_id}` — live agent timeline
- `GET /health` — health check

## Demo Target

The `vulnapi/` directory contains 5 seeded bugs aligned to agent innovations. See plan for details.

## Environment


| Variable            | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `LLM_PROVIDER`      | `anthropic` or `gemini` (default: `anthropic`)           |
| `GOOGLE_API_KEY`    | Google AI / Gemini API key (when `LLM_PROVIDER=gemini`)  |
| `GEMINI_MODEL`      | Gemini model id (default: `gemini-2.0-flash`)            |
| `ANTHROPIC_API_KEY` | Anthropic API key (when `LLM_PROVIDER=anthropic`)        |
| `ANTHROPIC_MODEL`   | Anthropic model id                                       |
| `GITHUB_TOKEN`      | GitHub PAT for PR creation                               |
| `REDIS_URL`         | Redis connection URL                                     |
| `STUB_MODE`         | Use stub agents (no API keys needed)                     |
| `GITHUB_DRY_RUN`    | Skip actual GitHub PR creation                           |


