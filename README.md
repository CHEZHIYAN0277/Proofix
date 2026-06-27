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
| `LLM_PROVIDER`      | `anthropic` or `mistral` (default: `anthropic`)          |
| `MISTRAL_API_KEY`   | Mistral API key (when `LLM_PROVIDER=mistral`)              |
| `MISTRAL_MODEL`     | Mistral model id (default: `codestral-latest`)             |
| `ANTHROPIC_API_KEY` | Anthropic API key (when `LLM_PROVIDER=anthropic`)        |
| `ANTHROPIC_MODEL`   | Anthropic model id                                       |
| `GITHUB_TOKEN`      | GitHub PAT for PR creation                               |
| `REDIS_URL`         | Redis connection URL                                     |
| `STUB_MODE`         | Use stub agents (no API keys needed)                     |
| `GITHUB_DRY_RUN`    | Skip actual GitHub PR creation                           |


