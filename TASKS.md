# Oracle — Task Tracking

## Current Phase

**Phase 4 In Progress** — GCP deployment (ingestion + agent web).

## Completed Tasks

### Phase 1: Data Ingestion

- [x] **Probed Polymarket APIs** — Gamma (events, markets, tags), CLOB (prices, order books), Data API. Documented all field shapes and quirks (double-encoded JSON strings, camelCase vs snake_case, string-typed numerics).
- [x] **Created shared types package** (`pkgs/shared`) — Zod schemas for GammaEvent, GammaMarket, ClobMarket, ClobToken. DB interfaces for events, markets, price_snapshots.
- [x] **Applied Supabase schema** — Tables: events, markets, price_snapshots, market_comments. Indexes on time-series queries, active records. Auto-update triggers.
- [x] **Built ingestion script** (`pkgs/ingestion`) — Fetches all active events+markets from Gamma API with pagination (7,800+ events, 47,500+ markets). Batched upserts with `postgres` npm package. Price snapshots from CLOB API (~9,500 captured).

### Phase 2: dbt Models & Lightdash

- [x] **Created SQL views** — `v_market_overview` (markets + events + category extraction from tags), `v_top_volume_markets`, `v_category_summary`, `v_price_snapshots`.
- [x] **Built Lightdash models** — `market_overview` (dimensions: question, category, price direction, volume, liquidity, spread; metrics: totals, averages, counts), `category_summary`, `price_snapshots`.
- [x] **Created 8 charts** — 4 KPI big numbers (markets, volume, liquidity, spread), top markets table, volume by category bar, markets by category donut, price direction donut.
- [x] **Deployed dashboard** — "Oracle: Prediction Market Intelligence" with KPI strip, category breakdowns, market direction, about section, and top markets table.

### Phase 3: Agent Layer

- [x] **Built Claude agent service** (`pkgs/agent`) — Anthropic TypeScript SDK with streaming, manual agentic loop, 4 tools.
- [x] **Implemented tools** — `query_database` (SQL against Supabase), `get_live_price` (CLOB API), `get_order_book` (CLOB API), `fetch_gamma_market` (Gamma API for fresh price changes).
- [x] **Agent capabilities** — Morning briefing, explain movement, find divergence, compare markets — all driven by system prompt + tool access. Claude writes its own SQL queries.
- [x] **Interactive CLI** (`bun run start` in `pkgs/agent`) — Streaming responses, tool call indicators, multi-turn conversation with history, graceful shutdown.

## Blocked / Questions

- Price snapshots only cover ~10% of tokens (stopped early). Consider limiting to top-volume markets for efficiency.

### Phase 4: GCP Deployment

- [x] **SKIP_SNAPSHOTS env var** — Ingestion skips price snapshots when `SKIP_SNAPSHOTS=true` (events + markets only, ~2 min vs 30+)
- [x] **Agent web server** (`pkgs/agent/src/server.ts`) — Bun.serve() on PORT 8080, SSE streaming, in-memory sessions with 30-min TTL
- [x] **Chat UI** (`pkgs/agent/src/index.html`) — Dark-themed, streaming text, tool call badges, suggested prompts, markdown rendering
- [x] **Dockerfile** — `oven/bun:1` base, pnpm install, shared image for agent service + ingestion job
- [x] **Deploy scripts** — `deploy/setup.sh` (one-time GCP setup: APIs, Artifact Registry, Cloud Run Service + Job, Cloud Scheduler) and `deploy/deploy.sh` (rebuild + redeploy)

## Next Up

- [ ] Local Docker smoke test
- [ ] GCP deploy and end-to-end verification

## Key Decisions Log

| Decision | Choice | Reason |
| -------- | ------ | ------ |
| DB client | Direct Postgres (`postgres` npm) | Simpler, no extra Supabase keys needed |
| Runtime | Bun for scripts, pnpm for deps | Fast TypeScript execution, existing monorepo setup |
| Polymarket SDK | Not used | Pulls ethers v5, we only need read-only GET requests |
| dbt | Skipped, pure Lightdash YAML | dbt not installed, Lightdash YAML models are faster |
| Category extraction | Tags JSON parsing in SQL view | `category` field is empty on all Polymarket events |
| Supabase connection | Session pooler with `prepare: false` | Required for Supabase pooler compatibility |
| Agent model | Claude Sonnet 4.6 (configurable via ORACLE_MODEL) | Good balance of speed, cost, and quality for tool-use agent |
| Agent architecture | Manual agentic loop with streaming | Full control over conversation history, real-time output |
| Agent tools | SQL + CLOB + Gamma (4 tools) | Claude writes SQL directly — flexible, no wrapper needed |

## Credentials & Config

| Item | Location |
| ---- | -------- |
| Supabase DB creds | `pkgs/lightdash/.env` |
| Lightdash token | `pkgs/lightdash/.env.local` |
| Lightdash project | SIA Hack (`8a7d7ea6-20d2-4c9b-8666-ae8123b8fe3f`) |
| Dashboard URL | `https://app.lightdash.cloud/projects/8a7d7ea6-20d2-4c9b-8666-ae8123b8fe3f/dashboards` |
| Anthropic API key | Root `.env` (ANTHROPIC_API_KEY) |
| Agent CLI | `cd pkgs/agent && bun run start` |
| Agent Web | `cd pkgs/agent && bun run serve` (or Docker) |
| GCP Setup | `./deploy/setup.sh` |
| GCP Redeploy | `./deploy/deploy.sh` |
