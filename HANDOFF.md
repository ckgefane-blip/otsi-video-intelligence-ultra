# OTSI Video Intelligence Engine (VIE v3) — Agent Handoff Document
**Prepared for:** Muse / Ziggy & Collaborating AI Agents  
**Date:** 2026-11-10  
**Handoff Branch:** `handoff/muse-assessment-2026-11-10`  
**Repository:** [https://github.com/awore-otsi/otsi-video-intelligence](https://github.com/awore-otsi/otsi-video-intelligence)

---

## 1. What OTSI VIE Is (Overview)
The **OTSI Video Intelligence Engine (VIE)** is a professional football (soccer) video analytics and tactical intelligence platform engineered by TEE Solutions International (OTSI). 
VIE transforms raw tactical match footage into calibrated pitch-plane telemetry, continuous multi-object player tracking, jersey number recognition, automated tactical event candidate detection (passes, shots, transitions, counter-pressures, set pieces), and exportable professional deliverables.
Rather than relying on unverified heuristics, VIE enforces strict "Analysis Truth": every event, formation, and physical metric is backed by sensor evidence, pitch homography calibration, and human-in-the-loop analyst verification. Deliverables include verified Player Spotlight highlight reels, PDF scouting reports, and non-linear editor interchange exports (`.otio`, `.otsi-reel`, `.otsi-archive`).

---

## 2. Tech Stack & Architecture

### High-Level Architecture
```
                         ┌───────────────────────────────────────────────┐
                         │                 Next.js 15 Web                │
                         │    (React 19, Tailwind CSS, Lucide Icons)     │
                         │               Port: 4310 / UI                 │
                         └───────────────────────┬───────────────────────┘
                                                 │ HTTP / REST
                                                 ▼
                         ┌───────────────────────────────────────────────┐
                         │              NestJS 11 + Fastify              │
                         │       (JWT RS256, Zod Contracts, Outbox)      │
                         │               Port: 4320 / API                │
                         └───────┬───────────────────────────────┬───────┘
                                 │                               │
                      Domain SQL │                    Outbox Bus │
                                 ▼                               ▼
                 ┌───────────────────────────────┐  ┌────────────────────────────┐
                 │           MySQL 8.4           │  │   Python Worker Engine     │
                 │ 66 Migrations, Guard Triggers │  │ (OpenVINO, YOLO, DINOv2,   │
                 │ Least-Privilege Role Grants   │  │  PyAV, SciPy, OpenCV, OCR) │
                 │ Ports: 3508 (live), 3507 (test│  └────────────────────────────┘
                 └───────────────────────────────┘
```

### Stack Breakdown
- **Frontend (`otsi-vie/apps/web`)**: Next.js 15.1.3, React 19, Tailwind CSS, Lucide React, HTML5 Canvas / SVG pitch visualizers.
- **Backend API (`otsi-vie/apps/api`)**: NestJS 11, Fastify 5 adapter, `@otsi-vie/contracts` schema validation, transactional Outbox dispatcher.
- **Shared Contracts (`otsi-vie/packages/contracts`)**: Pure TypeScript + Zod schemas for all API payloads, event types, telemetry, interchange manifests, and audit events.
- **Computer Vision Worker (`otsi-vie/services/worker`)**: Python 3.12, OpenVINO, PyTorch / Torchvision, OpenCV, PyAV (FFmpeg), DINOv2 Re-ID, YOLOv8/RT-DETR tracking, SciPy.
- **Database (`otsi-vie/database`)**: MySQL 8.4 Enterprise/Community. Strict least-privilege security model (`otsi_app` application role, append-only history ledgers, tenant composite keys).
- **Tooling & Orchestration (`otsi-vie/tools`)**: Custom CLI suite (`local_stack.py`, `migrate.py`, `roles.py`, `backup.py`, `production_check.py`, `load_test.py`, `vie_render.py`).

---

## 3. Workspace & Folder Structure
```
VIE-Engine-v2/
├── .env.example             # Template for local and production environment variables
├── .gitignore               # Strict exclusion of node_modules, venvs, caches, secrets, video files
├── CLAUDE.md                # Binding agent system instructions, architectural rules, and safety bounds
├── HANDOFF.md               # This document (onboarding & parallel collaboration guide)
├── README.md                # General project summary and quickstart
├── blueprint/               # Authoritative handoff archives, ADR records, v3 specs, and CHANGELOG.md
│   ├── CHANGELOG.md         # Comprehensive ledger of all ADRs and architectural changes
│   ├── CORRECTIONS.md       # Initial database schema corrections
│   ├── OTSI-Owner Developer Handoff/ # Extracted owner specification files
│   └── v3/                  # v3 Screen-level upgrade blueprints and design inventories
├── logos/                   # High-res OTSI branding and iconography
├── otsi-vie/                # Main application monorepo
│   ├── apps/
│   │   ├── api/             # NestJS API backend (`apps/api/src/`)
│   │   │   └── test/        # Vitest API unit & integration test suite
│   │   └── web/             # Next.js web application (`apps/web/src/`)
│   │       └── test/        # Vitest frontend component test suite
│   ├── database/
│   │   └── migrations/      # 66 sequential idempotent MySQL migrations (0001–0066)
│   ├── docs/
│   │   ├── ADRs/            # 124 Architecture Decision Records (ADR-001 through ADR-124)
│   │   ├── handover/        # Historical handover reports (HANDOVER_CURRENT.md)
│   │   └── runbooks/        # Backup/restore and production deployment operational guides
│   ├── packages/
│   │   └── contracts/       # Shared TypeScript & Zod schemas package
│   ├── release-evidence/    # Empirical validation evidence and CI test logs
│   ├── services/
│   │   └── worker/          # Python video analysis, tracking, and rendering worker
│   │       ├── tests/       # Pytest test suite for worker and computer vision modules
│   │       └── vie_worker/  # Worker source (actions, appearance, ball, detect, render, tracker)
│   └── tools/               # Local stack runner, database migrator, role provisioner, load tester
└── Owner's Request/         # Historical prompts, raw artwork, and UI inventories
```

---

## 4. How to Install Dependencies & Run Locally

### Prerequisites
- Windows 10/11 or Linux x86_64
- Node.js 22.x LTS and pnpm (or corepack enabled)
- Python 3.12 with virtualenv
- MySQL 8.4 running locally on port 3508 (live/dev) and port 3507 (automated test harness)
- FFmpeg installed in system PATH

### Installation Commands
```bash
# 1. Clone repository
git clone https://github.com/awore-otsi/otsi-video-intelligence.git
cd otsi-video-intelligence

# 2. Python Environment Setup
python -m venv .venv
# On Windows PowerShell:
.venv\Scripts\Activate.ps1
# On Linux/macOS:
source .venv/bin/activate
pip install -r otsi-vie/requirements.txt

# 3. Node.js Monorepo Setup
cd otsi-vie
pnpm install
pnpm --filter @otsi-vie/contracts run build
```

### Running the Full Local Stack
The project includes a single zero-friction local stack orchestrator that starts the API, Web, Outbox Dispatcher, and 3 Python worker pools simultaneously:
```bash
# From workspace root with python venv activated:
python otsi-vie/tools/dev/local_stack.py run
```
- Web Client: [http://127.0.0.1:4310](http://127.0.0.1:4310)
- REST API: [http://127.0.0.1:4320](http://127.0.0.1:4320)
- Public Tunnel (if configured): [https://vie.otsi.cc](https://vie.otsi.cc)

---

## 5. Environment Variables & `.env.example`
A complete template is committed at `.env.example`. Required environment variables:
- `OTSI_VIE_DB_DSN`: MySQL connection string for the `otsi_app` application role (e.g. `mysql://otsi_app:password@127.0.0.1:3508/otsi_owner_vie`).
- `OTSI_VIE_ROOT_DSN`: MySQL admin/root connection used strictly for running migrations (`tools/db/migrate.py`).
- `OTSI_VIE_PORT`: API listening port (default: `4320`).
- `OTSI_VIE_STORAGE_DIR`: Local disk storage path for video chunks and render artifacts (default: `.local/storage`).
- `OTSI_VIE_PUBLIC_ORIGIN`: Public URL of the frontend (default: `http://127.0.0.1:4310` or `https://vie.otsi.cc`).
- `OTSI_VIE_JWT_ISSUER`: JWT token issuer identifier.
- `OTSI_VIE_JWT_AUDIENCE`: Target JWT audience (`otsi-vie-api`).
- `OTSI_VIE_OUTBOX_POLL_MS`: Transactional outbox polling frequency in ms (default: `500`).

---

## 6. Project Status: Done, In Progress, and Next

### What Is DONE
1. **Phases A through D**: Complete foundational architecture, 10 screen layouts, clip studio, dual-timeline editing, audio mastering, export presets, admin console, retention/GDPR controls, automated load testing, and release gates dashboard.
2. **Phase E (Analysis Truth — E.1 through E.8)**:
   - **E.1**: Analyst event verification (`event_decisions`, ADR-118).
   - **E.2**: Delivery bundles & packaging (ADR-058).
   - **E.3**: Canonical formations inference & confirmation (`4-3-3`, `4-2-3-1`, stability %, defensive line height; ADR-123, migration 0066).
   - **E.4**: Transitions & counter-press analytics (ADR-119).
   - **E.5**: Cross-match smart search by player, event, and match half bounds (ADR-120, migration 0064).
   - **E.6**: Rigorous event evidence rules for tackles, interceptions, progressive passes, PPDA, off-ball runs, carries, and non-fabricated xG/xA (ADR-124).
   - **E.7**: High Press Success, Final-Third Regains, and Avg Press Height (ADR-121).
   - **E.8**: Role confirmation by human analyst (`role_confirmation`, ADR-122, migration 0065).

### What Is IN PROGRESS (Current Task)
- **Track U (Player Auto-Tracking & Engine Ultra-Enhancements)**:
  - **U.1**: Occlusion-protected phase follower in `follow.py` to freeze FFT template updates during player-player mutual crossings, preventing identity swaps.
- **Regular User Upload Walkthrough**:
  - Waiting for the owner to finalize game selections from `D:\Videos-Full Matches\Abkhazia Premier League` (Sukhum matches) to execute browser-driven upload testing at `https://vie.otsi.cc/upload` with zero database shortcuts.

### What Is NEXT
1. **Track U.2–U.12**: Deep-EIoU + DINOv2 association gate, intra-track swap splitter, pitch-plane Kalman tracking, grass-masked part Re-ID, super-resolved perspective OCR, and OpenVINO AsyncInferQueue.
2. **Commercial Pilot Packaging (Option B: Managed Service)**:
   - Restricting commercial catalog strictly to **Single Match Spotlight** and **Scouting Pack** (Team Tactical held back).
   - Establishing unit cost (compute + analyst minutes per match) to establish price floor.
   - Bank transfer invoicing workflow (no self-service credit card gateway until Phase 4).

### Known Bugs / Active Constraints
- **Never touch port 3306**: The host MySQL runs on port 3306 for legacy services. VIE uses port 3508 (live/dev) and port 3507 (test).
- **Line Ending Fidelity**: Git and code files must strictly preserve native line endings (CRLF for `blueprint/CHANGELOG.md`, `Panels.tsx`, `TacticsStage.tsx`, and python/migrations; LF for web/API files).
- **No Uncalibrated Fabrication**: If pitch calibrations are missing or confidence is low, metrics must display `—` with honest "Not measured" explanations rather than fabricated estimations.

---

## 7. How to Run Tests & Current Status

### Web Test Suite (Vitest)
```bash
cd otsi-vie/apps/web
node ../../node_modules/.pnpm/vitest@2.1.8_@types+node@22.10.2_jsdom@25.0.1/node_modules/vitest/vitest.mjs run
```
- **Status:** **61/61 test files passed, 242/242 unit tests passing** (0 errors).

### API Test Suite (Vitest)
```bash
cd otsi-vie/apps/api
node ../../node_modules/.pnpm/vitest@2.1.8_@types+node@22.10.2_jsdom@25.0.1/node_modules/vitest/vitest.mjs run
```
- **Status:** All unit and integration tests passing against isolated test MySQL on port 3507.

### Python Worker & Database Tests (Pytest)
```bash
pytest otsi-vie/tests/db
pytest otsi-vie/services/worker/tests
```
- **Status:** All database behavior tests and worker job tests passing.

### Production Build Verification
```bash
cd otsi-vie/apps/web
npm run build
```
- **Status:** Next.js production build compiles cleanly with all 25 static/dynamic routes prerendered successfully.

---

## 8. Historical Context & AI Collaboration Record
- **Claude Code (Anthropic)**: Authored initial foundation, migrations 0001–0055, and Phase A/B baseline architectures.
- **ChatGPT Codex (OpenAI)**: Authored backup verification overhaul (`tools/db/backup.py verify`), tmpfs memory fixes, and Phase C/D enhancements.
- **Antigravity (Google DeepMind)**: Completed Phase D.3–D.10 governance, Phase E.1–E.8 Analysis Truth implementation, ADRs 111–124, and initiated Track U.
- **Muse / Ziggy (Incoming)**: Performing parallel assessment, code review, and independent roadmap execution.
