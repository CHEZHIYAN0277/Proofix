#  Autonomous Multi-Agent Bug Detection Backend

FastAPI + LangGraph pipeline for autonomous bug detection, repair, validation, and GitHub PR creation.

## Quick Start

```bash
# 1. Create venv and install
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m spacy download en_core_web_sm
cp .env.example .env   # then set MISTRAL_API_KEY, STUB_MODE=false

# 2. Start Redis (pick one)
brew services start redis          # macOS with Homebrew (no Docker needed)
# OR: docker compose up -d         # if Docker is installed

# 3. Start API (use venv uvicorn — not global shell PATH)
source .venv/bin/activate
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

# 4. In another terminal — create a run
curl -X POST http://127.0.0.1:8000/runs \
  -H "Content-Type: application/json" \
  -d '{"repo_path": "vulnapi"}'
```

If `uvicorn` is "command not found", either activate `.venv` first or run:
`.venv/bin/uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`

## Frontend

The React execution workspace lives in `frontend/`. Run it alongside the API:

```bash
cd frontend
npm install
cp .env.example .env      # then set VITE_DATA_SOURCE=api
npm run dev               # http://localhost:5173
```

`VITE_DATA_SOURCE=mock` (the default) runs the UI standalone on bundled
fixtures — useful for design work with no backend or Redis. Setting it to
`api` streams real runs. In dev, Vite proxies `/api` and `/ws` to
`127.0.0.1:8000`, so the browser sees one origin and CORS never applies.

## API

Pipeline API:

- `POST /runs` — start a pipeline run
- `GET /runs/{run_id}` — run status
- `GET /runs/{run_id}/sig` — Semantic Intent Graph
- `GET /runs/{run_id}/events` — event history
- `GET /runs/{run_id}/proof/{issue_id}` — proof-of-fix bundle
- `WS /ws/runs/{run_id}` — live agent timeline
- `GET /health` — health check

Workspace API (`backend/api/routes/ui.py`) — view models for the frontend,
projected by `backend/services/ui_projection.py` so the UI never sees raw
pipeline JSON:

- `GET /api/repositories` — runs grouped by repository (sidebar)
- `POST /api/repositories/validate` — resolve a repo reference to metadata
- `POST /api/runs` — start a run from the UI
- `GET /api/runs/{run_id}` — workspace header
- `GET /api/runs/{run_id}/summary` — AI executive summary
- `GET /api/runs/{run_id}/agents` — execution journal cards (one per agent)
- `GET /api/runs/{run_id}/attempts` — repair attempt sequence
- `GET /api/runs/{run_id}/report` — final run report and trust axes
- `POST /api/runs/{run_id}/chat` — answer questions from captured evidence

## Demo Target

The `vulnapi/` directory contains 5 seeded bugs aligned to agent innovations. See plan for details.

## Environment


| Variable            | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `LLM_PROVIDER`      | `anthropic` or `mistral` (default: `anthropic`)          |
| `MISTRAL_API_KEY`   | Mistral API key (when `LLM_PROVIDER=mistral`)              |
| `MISTRAL_MODEL`     | Mistral model id (default: `codestral-latest`)             |
| `ANTHROPIC_API_KEY` | Anthropic API key (when `LLM_PROVIDER=anthropic`)        |
| `ANTHROPIC_MODEL`   | Anthropic model id                                       |
| `GITHUB_TOKEN`      | GitHub PAT for PR creation                               |
| `REDIS_URL`         | Redis connection URL                                     |
| `STUB_MODE`         | Use stub agents (no API keys needed)                     |
| `GITHUB_DRY_RUN`    | Skip actual GitHub PR creation                           |


