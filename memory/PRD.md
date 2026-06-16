# ItaliaModa AI Agent — PRD

## Original Problem Statement
"загрузи проект с гитхаб" — load project from GitHub: https://github.com/l2maxwel-jpg/ItaliaModa-AI-Agent.git

## Project Overview
**Name:** PrestaShop 8.2 AI Agent (ItaliaModa)
**Purpose:** AI-powered tool that auto-extracts product metadata (SKU, price, title, description, composition, model info) from product photos using Google Gemini and publishes them directly to a PrestaShop 8.2 store.
**Stack (original):** Vite + React 19 + TypeScript (frontend), Express + tsx (backend), @google/genai SDK, Tailwind v4, motion, lucide-react.

## Architecture (Emergent-adapted)
Original repo had a single Node Express server handling both Vite SSR and `/api/*` routes on port 3000. Emergent supervisor requires:
- `backend`: uvicorn from `/app/backend` on port 8001
- `frontend`: `yarn start` from `/app/frontend` on port 3000

### Adaptation
- Moved repo into `/app/frontend/`
- `/app/frontend/package.json` `start` script changed to `tsx server.ts`
- `/app/backend/server.py` is a thin FastAPI proxy that forwards every `/api/*` request to `http://localhost:3000/api/*`
- Node upgraded to v22 (required by `undici@8`)
- Vite `allowedHosts: true` to accept Emergent preview hostnames
- `GEMINI_API_KEY` is loaded by `dotenv` in `server.ts` from `/app/frontend/.env`

## What's Implemented (2026-01-16)
- Repo cloned and restructured to Emergent layout
- Dependencies installed (yarn)
- Backend proxy implemented and running
- Frontend running with Vite middleware on port 3000
- GEMINI_API_KEY configured (user-provided)
- UI verified loading: PrestaShop 8.2 AI Agent dashboard renders

## Core Features (from upstream repo)
- Photo upload (drag-and-drop, file picker, webcam)
- AI metadata extraction (Gemini): title, sku, price, sklad, modelka, variants, descriptions, categories
- Field regeneration per attribute
- PrestaShop integration: test connection, fetch categories, create product, update product
- Polish/Russian UI toggle
- Session activity log

## Backlog / Next Tasks
- P1: Verify Gemini model name (`gemini-3.5-flash` is used in code — may need update to `gemini-2.5-flash` or `gemini-3-flash` depending on Google's current naming)
- P1: End-to-end test with real product photo + PrestaShop credentials
- P2: Configure production build flow (`yarn build` + `node dist/server.cjs`)
- P2: Add deployment-ready Dockerfile or supervisor `start:prod` mode
