# OTSI Video Intelligence Engine (VIE v3)

> Professional AI-powered football (soccer) video analytics, calibrated tactical intelligence, and verified broadcast reel generation platform.

[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.1.3-black.svg)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11.x-red.svg)](https://nestjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8.4-blue.svg)](https://www.mysql.com/)
[![Python](https://img.shields.io/badge/Python-3.12-yellow.svg)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)]()

---

## What is OTSI VIE?

**OTSI Video Intelligence Engine (VIE)** is a football analytics platform developed by TEE Solutions International (OTSI). VIE converts standard tactical match recordings into pitch-plane telemetry, continuous multi-object player tracking, jersey number recognition, and verified tactical event data (passes, shots, transitions, pressing, set pieces).

Built on the principle of **Analysis Truth**, VIE enforces rigorous evidence rules: metrics without sensor or calibration evidence are explicitly designated "Not measured" rather than fabricated. Deliverables include verified Player Spotlight highlight reels, PDF scouting reports, and NLE interchange exports (`.otio`, `.otsi-reel`, `.otsi-archive`).

For incoming developers and collaborating AI agents, read the comprehensive handoff guide:
👉 **[HANDOFF.md](./HANDOFF.md)**

---

## System Architecture

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

- **Frontend (`otsi-vie/apps/web`)**: Next.js 15.1.3, React 19, Tailwind CSS, Lucide icons.
- **Backend API (`otsi-vie/apps/api`)**: NestJS 11 + Fastify 5, RS256 JWT auth, transactional Outbox dispatcher.
- **Contracts (`otsi-vie/packages/contracts`)**: Pure TypeScript + Zod schemas shared across web and API.
- **Worker Engine (`otsi-vie/services/worker`)**: Python 3.12, PyAV (FFmpeg), OpenVINO, YOLOv8/RT-DETR, DINOv2.
- **Database (`otsi-vie/database`)**: MySQL 8.4 with 66 sequential migrations and least-privilege RBAC.

---

## Quickstart & Local Setup

### 1. Prerequisites
- Node.js 22.x LTS & pnpm
- Python 3.12 with `venv`
- MySQL 8.4 (running on port 3508 for dev, port 3507 for test harness)
- FFmpeg installed in system PATH

### 2. Install Dependencies
```bash
# Clone repository
git clone https://github.com/awore-otsi/otsi-video-intelligence.git
cd otsi-video-intelligence

# Setup Python environment
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# Linux/macOS:
source .venv/bin/activate
pip install -r otsi-vie/requirements.txt

# Setup Node.js Monorepo
cd otsi-vie
pnpm install
pnpm --filter @otsi-vie/contracts run build
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env` and configure your local credentials:
```bash
cp .env.example .env
```

### 4. Run the Full Local Stack
```bash
# From workspace root with Python venv activated:
python otsi-vie/tools/dev/local_stack.py run
```
- **Web Interface:** [http://127.0.0.1:4310](http://127.0.0.1:4310)
- **API Server:** [http://127.0.0.1:4320](http://127.0.0.1:4320)
- **Public Tunnel (if active):** [https://vie.otsi.cc](https://vie.otsi.cc)

---

## Running Automated Tests

```bash
# Web Component Tests (Vitest - 61 test files, 242 tests)
cd otsi-vie/apps/web
node ../../node_modules/.pnpm/vitest@2.1.8_@types+node@22.10.2_jsdom@25.0.1/node_modules/vitest/vitest.mjs run

# API Integration Tests (Vitest - runs against test DB port 3507)
cd otsi-vie/apps/api
node ../../node_modules/.pnpm/vitest@2.1.8_@types+node@22.10.2_jsdom@25.0.1/node_modules/vitest/vitest.mjs run

# Database Suite & Python Worker Tests (Pytest)
pytest otsi-vie/tests/db
pytest otsi-vie/services/worker/tests
```

---

## Project Status & Key Documents

- **Handoff & Agent Guide:** [`HANDOFF.md`](./HANDOFF.md)
- **Architecture Decision Records:** [`otsi-vie/docs/ADRs/`](./otsi-vie/docs/ADRs/) (ADR-001 through ADR-129)
- **Architecture Changelog:** [`blueprint/CHANGELOG.md`](./blueprint/CHANGELOG.md)
- **Agent Operating Rules:** [`CLAUDE.md`](./CLAUDE.md)
- **Production Runbook:** [`otsi-vie/docs/runbooks/PRODUCTION_DEPLOYMENT.md`](./otsi-vie/docs/runbooks/PRODUCTION_DEPLOYMENT.md)

---

## Core Guidelines & Safety Bounds
1. **Database Isolation**: Never connect to port 3306 (reserved for legacy host services). Dev DB is port 3508; test DB is port 3507.
2. **Analysis Truth**: Never fabricate any metric. If sensor evidence or pitch homography is missing, mark as "Not measured" with clear reasons.
3. **Line Ending Fidelity**: Strictly preserve native line endings (CRLF for blueprints, changelog, python, migrations, and key frontend components; LF for web/API).
