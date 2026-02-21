# Plan: `/self-improve` Claude Code Skill

## Context

Oracle logs every user query to `user_queries` in Supabase, and `improve.ts` already generates improvement proposals into `improvement_proposals`. But today this is a manual, disconnected process — someone has to run the script, read the DB, decide what to change, make edits, and deploy. We want a single `/self-improve` slash command that orchestrates the entire feedback loop end-to-end, with a developer approval gate before any code changes ship.

## What We're Building

A Claude Code skill at `.claude/skills/self-improve/SKILL.md` — a single markdown file that instructs Claude Code to follow a structured 6-phase workflow:

1. **Generate** — Run `bun run improve` to create fresh proposals from recent queries
2. **Gather** — Query the DB for proposals, analytics summary, tool usage, errors, latency outliers
3. **Analyze** — Score and prioritize proposals (impact x feasibility x evidence)
4. **Plan** — Present a tiered implementation plan (quick wins / high impact / strategic / skip)
5. **Implement** — After developer approval, make code changes to the agent
6. **Deploy** — Lint, typecheck, commit, run `deploy/deploy.sh`, mark proposals as implemented

## File Changes

| File | Action |
| ------ | -------- |
| `.claude/skills/self-improve/SKILL.md` | **Create** — Full skill definition (~200 lines) |

That's it — one new file. The skill is purely instructional (like `developing-in-lightdash`), telling Claude Code what to do at each phase.

## Key Design Decisions

- **improve.ts runs as Phase 1** inside the skill (skippable if proposals already exist)
- **Explicit approval gate** between Phase 4 (present plan) and Phase 5 (implement) — Claude Code must wait for confirmation
- **SQL queries are inline** in the skill so Claude Code can gather data via `PGPASSWORD=... psql` or the Supabase MCP connection
- **Impact mapping table** maps proposal categories → specific agent source files, so Claude Code knows where each type of change lands
- **DB schema reference** included so Claude Code can write correct UPDATE statements to mark proposals as implemented

## Skill Structure

```text
Phase 1: Generate    → bun run improve (optional, default on)
Phase 2: Gather      → 6 SQL queries for proposals + analytics
Phase 3: Analyze     → Score by impact(40%) / feasibility(30%) / evidence(20%) / risk(10%)
Phase 4: Plan        → Present tiered plan, WAIT for approval
                       ─── APPROVAL GATE ───
Phase 5: Implement   → Edit agent files, guided by category→file mapping
Phase 6: Deploy      → lint → typecheck → commit → deploy/deploy.sh → mark implemented
```

## Verification

1. Invoke `/self-improve` in Claude Code
2. It should run `improve.ts`, query the DB, and present a prioritized plan
3. After approval, it should make targeted code changes to the correct files
4. Lint and typecheck should pass
5. Deploy should complete and print the Cloud Run URL
6. Proposals should be marked `implemented` in the DB
