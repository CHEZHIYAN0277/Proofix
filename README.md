# 🛠️ ProoFix

### **Autonomous Multi-Agent Repository Analysis, Bug Investigation & Validated Fix Generation**

![Status](https://img.shields.io/badge/Status-Active-43A047?style=flat-square)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)
![Frontend](https://img.shields.io/badge/Frontend-React-0088CC?style=flat-square&logo=react&logoColor=white)
![Backend](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![Orchestration](https://img.shields.io/badge/Orchestration-LangGraph-E65100?style=flat-square&logo=python&logoColor=white)
![LLM](https://img.shields.io/badge/LLM-Claude%20%7C%20Codestral-D81B60?style=flat-square)
![Database](https://img.shields.io/badge/Database-Redis-DC382D?style=flat-square&logo=redis&logoColor=white)

---

## 📌 Overview

**ProoFix** is an AI-powered software engineering platform that provides automated codebase analysis, bug detection, root-cause investigation, blast-radius evaluation, candidate fix generation, patch mutation validation, and GitHub pull request creation.

The system combines a **React frontend**, **FastAPI backend**, **LangGraph multi-agent orchestration pipeline**, and **Redis async state engine**.

Rather than relying on a single LLM to inspect a repository and directly modify code, ProoFix uses a structured pipeline of specialized agents. Each stage produces verifiable evidence and structured artifacts passed deterministically to subsequent agents.

---

## 🚀 Why ProoFix?

Traditional AI coding assistants generate code snippet fixes in isolation, but repository-level debugging requires rigorous verification. Without structural analysis and runtime validation, AI-generated code often suffers from:

* **Misdiagnosed Root Causes** — Fixes applied to symptoms rather than root causes.
* **Incorrect File Targets** — Changes made to wrong files or wrong library layers.
* **Dependency & API Inconsistencies** — Code that breaks internal interfaces or type contracts.
* **Lack of Reproduction** — Inability to prove that a bug actually existed before fixing it.
* **Regressions** — Passing initial target checks while breaking peripheral features.
* **Unverified Security** — Patching logic while introducing secondary security flaws.

ProoFix resolves these challenges through strict separation of concerns: **Detection → Reproduction → Investigation → Blast Scope → Fix Planning → Code Generation → Mutation & Security Validation**.

```text
                    Target Repository
                            │
                            ▼
                  ┌──────────────────┐
                  │ Repository Input │
                  └────────┬─────────┘
                           │
                           ▼
                    ┌────────────┐
                    │ A0         │
                    │ Orchestrator
                    └─────┬──────┘
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
       A1 Mapper      A2 Dependency     A3 Static
       Analysis       Analysis          Analysis
          │               │                │
          └───────────────┼────────────────┘
                          ▼
                    A3.5 Reproduction
                          │
                          ▼
                   A4 Evidence
                   Investigation
                          │
                          ▼
                   A5 Blast Radius
                   / Impact Analysis
                          │
                          ▼
                   A6 Fix Planner
                          │
                          ▼
                   A7 Code Generator
                          │
                          ▼
                   A8 Mutation /
                   Fix Validator
                          │
                          ▼
                   A9 Security
                   Re-scan
                          │
                          ▼
                   A10 Final Decision
                          │
                          ▼
                   Pull Request /
                   Developer Review
```

---

## ✨ Key Features

### 🔍 Deep Repository Understanding
Builds a comprehensive structural model of the repository before attempting any modification:
* **Semantic Mapping (A1)** — Builds a Semantic Intent Graph (SIG) from AST analysis, functions, and docstrings.
* **Dependency Graphing (A2)** — Maps cross-module imports, inter-function callability, and reachability.
* **Source Roots Discovery** — Dynamically discovers source paths and module hierarchies.

### 🐛 Multi-Source Bug Detection
Combines deterministic tooling and structured reasoning instead of single-prompt guessing:
* **Static Analysis (A3)** — Linter, type checking, and pattern-based vulnerability scanning (Bandit/Ruff).
* **Dependency Reachability** — Traces external vulnerability propagation across execution paths.
* **Runtime Verification** — Verifies issues through real code execution.

### 🧪 Deterministic Reproduction (A3.5)
Generates and executes targeted test cases against the codebase to establish hard baseline proof:
* Captures exit codes, stdout, stderr, and pytest execution reports.
* Enforces a hard **Reproduction Gate** — requires consistent reproduction (10/10 stability score) before declaring a bug confirmed.
* Prevents spending LLM tokens on non-reproducible or hallucinated issues.

### 🔬 Provenance-Gated Evidence Investigation (A4)
Correlates evidence across scanner outputs, test logs, call graphs, and source code citations:
```text
Supporting Evidence
        │
        ├── Reproduction (Automated Pytest Runs)
        ├── Scanners (Bandit / Static Linter)
        ├── Source Code (AST Citations)
        └── Dependency Graph (Call Trees)

Contradicting Evidence
        │
        └── Flagged when evidence fails to validate findings

Unavailable Evidence
        │
        ├── Tools uninstalled / inactive
        └── Non-executable test suites
```

### 💥 Blast Radius & Impact Analysis (A5)
Measures the blast radius of proposed code edits across the repository architecture:
* Evaluates downstream caller impact.
* Prevents fixing one component while breaking dependent modules.

### 🧠 Structured Fix Planning & Code Generation (A6 & A7)
* **A6 Fix Planner**: Formulates a detailed DAG fix plan outlining file-level change dependencies, modification order, and validation constraints.
* **A7 Patch Engine**: Generates clean, minimal patch diffs based strictly on the approved fix plan and targeted context snippets.

### 🧬 Mutation & Security Validation (A8 & A9)
* **A8 Mutation Validator**: Executes regression suites and mutation testing (`mutmut`) to guarantee that generated patches fix the bug without introducing regressions.
* **A9 Security Rescan**: Re-scans modified files to guarantee no new security vulnerabilities were introduced by the patch.
* **Automatic Retry Loop**: If validation fails, feeds exact failure tracebacks back to **A7** for iterative repair up to configured retry limits.

### 📊 Trust Gating & MCI Certification (A10)
Calculates a **Mutation Certification Index (MCI)** based on empirical metrics. Pull Requests are only submitted when all trust gates pass.

### 💬 Workspace AI Chatbot & Voice Navigation
Interactive developer dashboard featuring:
* **Evidence-Based Q&A**: Ask natural language questions grounded strictly in captured run evidence.
* **Voice Input**: Integrated voice navigation powered by server-side speech recognition.

---

## 🏗️ Architecture & Agent Pipeline

| Agent | Module Name | Core Responsibility |
| :--- | :--- | :--- |
| **A0 / A0.5** | `repository_intelligence.py` | Orchestration, cross-run caching, knowledge graph indexing |
| **A0.7** | `a0_7_environment.py` | Precheck environment & test runner readiness |
| **A1** | `a1_semantic_mapper.py` | AST parsing, docstrings, Semantic Intent Graph (SIG) generation |
| **A2** | `a2_dependency_analyzer.py` | Call graph construction & import reachability analysis |
| **A3** | `a3_static_analysis.py` | Static vulnerability & code quality scanning (Bandit/Ruff) |
| **A3.5** | `a3_5_reproduction.py` | Test generation & 10/10 stability reproduction gating |
| **A4** | `a4_evidence_investigator.py` | Evidence correlation & root cause diagnosis |
| **A5** | `a5_blast_graph.py` | Downstream impact & blast radius calculation |
| **A5.5** | `a5_5_context_engineering.py` | Target snippet context engineering for LLM prompts |
| **A6** | `a6_fix_dag_planner.py` | Fix DAG planning & file modification ordering |
| **A7** | `a7_code_generation.py` | Code patch generation and safe application |
| **A8** | `a8_mutation_validator.py` | Regression execution & mutation validation (`mutmut`) |
| **A9** | `a9_security_rescan.py` | Post-fix security rescan & vulnerability verification |
| **A10** | `a10_routing.py` / `a10_mci_scorer.py` | MCI scoring, trust gating, and automated GitHub PR routing |

---

## 🔄 End-to-End Workflow

```text
1. Target Repository Input (Local path or Git URL)
              │
              ▼
2. Environment Precheck (A0.7) & Repo Indexing (A0.5)
              │
              ▼
3. Semantic Intent Graph (A1) & Dependency Mapping (A2)
              │
              ▼
4. Static Security Scanning (A3)
              │
              ▼
5. Reproduction Gating (A3.5)
              │
              ▼
6. Root Cause Evidence Investigation (A4)
              │
              ▼
7. Blast Radius Impact Analysis (A5)
              │
              ▼
8. Fix DAG Planning (A6)
              │
              ▼
9. Patch Generation & Application (A7)
              │
              ▼
10. Mutation & Regression Validation (A8) ───(Fail / Retry)───► [Refine Patch]
              │
              ▼
11. Post-Patch Security Rescan (A9) ─────────(Fail / Retry)───► [Refine Patch]
              │
              ▼
12. MCI Trust Gating & PR Decision (A10)
              │
              ▼
13. Automated GitHub Pull Request Creation & Developer Report
```

---

## 🧩 Technology Stack

### Backend
* **Language & Core**: Python 3.11+, FastAPI, Uvicorn, Pydantic v2
* **Agent Orchestration**: LangGraph, LangChain Core
* **LLM Engines**: Anthropic (`claude-3-5-sonnet`), Mistral (`codestral-latest`), Stub Mode
* **State & Storage**: Redis (Async state engine & event streaming)
* **Code Analysis**: Python AST, NetworkX, spaCy, PyGithub, GitPython
* **Verification & Security**: Pytest, Bandit, Ruff, MutMut

### Frontend
* **Framework**: React 18, TypeScript, Vite
* **Routing & Styling**: TanStack Router, Tailwind CSS, Lucide Icons
* **Workspace Engine**: Real-time WebSocket streaming, live timeline, diff inspector

---

## 📁 Project Structure

```text
Proofix/
├── backend/
│   ├── agents/               # Individual pipeline agents (A0.7 -> A10)
│   ├── api/routes/           # REST API & WebSocket endpoints
│   ├── models/               # Pydantic data schemas
│   ├── orchestrator/         # LangGraph workflow, nodes, edges & trust gates
│   ├── security/             # Security analysis & scanning modules
│   ├── services/             # Git operations, UI projection, graph caching
│   ├── state/                # Redis state store implementation
│   ├── config.py             # System settings & configuration
│   └── main.py               # FastAPI application entrypoint
├── frontend/
│   ├── src/
│   │   ├── components/       # UI components (Journal, Patch View, Timeline)
│   │   ├── hooks/            # Custom React hooks & WebSocket listeners
│   │   ├── routes/           # TanStack router page definitions
│   │   └── styles.css        # CSS styling rules
│   ├── package.json
│   └── vite.config.ts
├── vulnapi/                  # Seeded benchmark target repository
├── docs/                     # Architecture specifications & system design
├── tests/                    # Backend unit & integration tests
├── pyproject.toml            # Backend dependencies & tools config
└── README.md
```

---

## ⚙️ Getting Started

### Prerequisites
* **Python 3.11+**
* **Node.js 18+ & npm**
* **Redis** (Local instance or Docker container)
* **Git**

---

### 1. Clone & Setup Backend

```bash
# Clone repository
git clone https://github.com/your-org/Proofix.git
cd Proofix

# Create and activate virtual environment
python -m venv .venv

# macOS / Linux:
source .venv/bin/activate
# Windows:
.venv\Scripts\activate

# Install backend dependencies
pip install -e ".[dev]"

# Download spaCy NLP model
python -m spacy download en_core_web_sm

# Configure environment file
cp .env.example .env
```

---

### 2. Environment Configuration (`.env`)

Edit your `.env` file with appropriate API keys and settings:

```env
# Execution Mode
STUB_MODE=false               # Set to true for offline testing without LLM keys
LLM_PROVIDER=anthropic        # Options: anthropic | mistral

# API Keys
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Optional Mistral Config
# MISTRAL_API_KEY=your_mistral_api_key
# MISTRAL_MODEL=codestral-latest

# Infrastructure
REDIS_URL=redis://localhost:6379/0
GITHUB_TOKEN=your_github_pat_token

# Speech-to-Text (Voice input)
SARVAM_API_KEY=your_sarvam_api_key
```

---

### 3. Start Redis

Make sure Redis is running locally:

```bash
# macOS with Homebrew
brew services start redis

# Docker
docker run -d -p 6379:6379 redis:alpine
```

---

### 4. Run the FastAPI Backend

```bash
# Activate virtual environment
source .venv/bin/activate

# Start backend server
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```
* API documentation available at `http://127.0.0.1:8000/docs`
* Health check: `http://127.0.0.1:8000/health`

---

### 5. Run the React Frontend

Open a second terminal window:

```bash
cd frontend
npm install
cp .env.example .env      # Ensures VITE_DATA_SOURCE=api (or mock)
npm run dev
```
Open your browser at `http://localhost:5173`.

---

## 🧪 Running a Pipeline Job

You can initiate a repository repair job from the UI or via curl:

```bash
curl -X POST http://127.0.0.1:8000/runs \
  -H "Content-Type: application/json" \
  -d '{"repo_path": "vulnapi"}'
```

---

## 🔐 Security & Governance

ProoFix enforces strict security boundaries:
* **Server-Side API Key Isolation**: All LLM and third-party API credentials (such as Sarvam voice keys and GitHub tokens) remain strictly server-side.
* **No Unsandboxed Installs**: The `A0.7` environment precheck checks existing environment state without executing arbitrary build hooks from cloned target repositories.
* **Post-Fix Rescan**: All generated patches undergo automated security scanning (`A9`) before being considered safe for PR submission.

---

## 🧪 Testing

Run backend tests:

```bash
# Run unit and integration tests
pytest tests/ -q
```

Run frontend production build verification:

```bash
cd frontend
npm run build
```

---

## 💡 What Makes ProoFix Different?

Most AI coding tools operate as direct prompt-to-code generators:
```text
Prompt ──► LLM ──► Modified Code
```

ProoFix treats software repair as an **empirical, verifiable engineering process**:
```text
Repository ──► Map ──► Detect ──► Reproduce ──► Investigate ──► Blast Scope ──► Plan ──► Generate ──► Mutate ──► Rescan ──► PR
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository and create a feature branch (`git checkout -b feature/amazing-feature`).
2. Commit your changes (`git commit -m 'Add amazing feature'`).
3. Push to the branch (`git push origin feature/amazing-feature`).
4. Open a Pull Request.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
