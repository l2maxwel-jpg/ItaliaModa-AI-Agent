# ItaliaModa AI Agent — PRD

## Original Problem Statement
"загрузи проект с гитхаб" — load project from GitHub: https://github.com/l2maxwel-jpg/ItaliaModa-AI-Agent.git

## Project Overview
**Name:** PrestaShop 8.2 AI Agent (ItaliaModa)
**Purpose:** AI-powered tool that auto-extracts product metadata (SKU, price, title, description, composition, model info) from product photos using Google Gemini and publishes them directly to a PrestaShop 8.2 store, including per-variant photo associations for combinations.
**Stack (original):** Vite + React 19 + TypeScript (frontend), Express + tsx (backend), @google/genai SDK, Tailwind v4, motion, lucide-react.

## Architecture (Emergent-adapted)
- `/app/frontend/` — original Node + Vite project; `yarn start` runs `tsx server.ts` on port 3000 (includes Vite middleware + all /api/* routes + Gemini SDK + PrestaShop client).
- `/app/backend/server.py` — thin FastAPI proxy on port 8001 that forwards `/api/*` to `http://localhost:3000/api/*` (required because Emergent ingress sends /api/* to 8001).
- Node upgraded to v22 (required by undici@8).
- Vite `allowedHosts: true` to accept Emergent preview hostnames.
- `GEMINI_API_KEY` is loaded via dotenv from `/app/frontend/.env`.

## Implementation Log

### 2026-01-16 — Project setup
- Cloned private repo using user-provided GitHub PAT.
- Restructured to `/app/frontend` + `/app/backend` proxy.
- Installed Node 22 + yarn deps + Python deps (fastapi, httpx, uvicorn, python-dotenv).
- Configured GEMINI_API_KEY from user input.

### 2026-01-16 — Code-review fixes (🟢 + 🟡 scope per user)
- Empty catch block in `App.tsx:389` → adds console.error.
- Array key `key={i}` for variants → `key={v.name+"-"+i}` (stable on reorder).
- Inline motion props extracted to module-level constants (COLLAPSIBLE_*, MODAL_*).
- 9 nested ternaries replaced with helper fns (primaryActionButtonClass, fieldGenerateButtonClass, dropzoneClass) or if/else.
- `fetchCategories` wrapped in `useCallback([psConfig])` and added to effect deps.
- Expensive filter+map in `<select>` → `useMemo` as `selectedPsCategories`.
- 63 `console.log` calls in `server.ts` → dev-only `dlog` (silenced in production); `console.error`/`console.warn` preserved.

### 2026-01-16 — Bug fix: combination image associations
**Bug 1:** Photos selected per variant in the UI did not become "active" in PrestaShop combination edit dialog.
**Root cause A:** `getProductImageIds` used a single regex that only matched `<image><id>N</id></image>` directly in the product XML, but PrestaShop's `/products/{id}` endpoint without `?display=full` doesn't include the `<associations>` block, AND the dedicated `/images/products/{id}` endpoint returns a different shape (`<image id="..."><declination id="N"/>...</image>`), so we were matching the product container ID instead of the actual image IDs.
**Fix A:** Rewrote `getProductImageIds`:
- Strategy A (primary): `GET /products/{id}?display=full` → parse `<associations><images><image><id>N</id></image>` block.
- Strategy B (fallback): `GET /images/products/{id}` → multi-pattern parser supporting `<declination id="N"/>`, `<i><id>N</id></i>`, `<image><id>N</id></image>`; excludes the product container ID.
- Added diagnostic logging of XML snippet on parse failure.

**Root cause B:** When GET on `combinations/{id}` returned a brand-new combination, PrestaShop's `<images>` element was **self-closing**: `<images nodeType="image" api="images"/>`. The replacement regex only matched paired `<images>...</images>`, so the code fell into the else branch and inserted a SECOND `<images>` block before the existing empty self-closing one. PrestaShop honored the empty one and ignored our IDs → no active images.
**Fix B:** Updated regex in `linkImagesToCombination` to match both forms (`<images/>` and `<images>...</images>`), plus added a sanity check that warns if multiple `<images>` blocks remain after merge.

## Verified Working Flow (2026-01-16)
1. Upload up to 15 product photos
2. AI extraction via Gemini (title, sku, price, sklad, modelka, variants, descriptions)
3. Per-variant photo selection (e.g., 5 photos for Kremowy, 5 for Beżowy, 5 for Brązowy)
4. Publish to PrestaShop → product created with full metadata + categories
5. All 15 photos uploaded and indexed
6. 3 combinations created (Kolor + Rozmiar attributes)
7. Each combination has its **correct subset of photos marked as active** in PrestaShop combination edit dialog

## Backlog
- P2: Combination creation occasionally fails for one variant out of three (observed once on Product 2200 — Beżowy did not get stock; needs investigation if reproduced).
- P2: Verify `gemini-3.5-flash` model name (used in server.ts:208,318) is the right current alias.
- P3: Production build flow (`yarn build` + `node dist/server.cjs`) + supervisor `start:prod` mode.
- P3: 🔴 refactoring scope (deferred per user): split App.tsx (~2640 lines) into sub-components; reduce cyclomatic complexity in server.ts functions (findTaxRulesGroup, fetchPrestashop, etc.).
