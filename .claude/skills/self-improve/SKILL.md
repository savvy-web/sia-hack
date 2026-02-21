---
name: self-improve
description: Run the Oracle agent's self-improvement loop end-to-end. Generates proposals from recent user queries, analyzes and prioritizes them, presents an implementation plan for approval, then makes targeted code changes and deploys.
---

# Self-Improve

Run Oracle's complete self-improvement feedback loop: generate proposals from
user query logs, prioritize by impact, implement approved changes, and deploy.

## Phases Overview

```text
Phase 1: Generate    → bun run improve (create proposals from recent queries)
Phase 2: Gather      → SQL queries for proposals + analytics context
Phase 3: Analyze     → Score proposals by impact / feasibility / evidence / risk
Phase 4: Plan        → Present tiered plan, WAIT for developer approval
                       ─── APPROVAL GATE ───
Phase 5: Implement   → Edit agent source files guided by category→file map
Phase 6: Deploy      → lint → typecheck → commit → deploy → mark implemented
```

---

## Phase 1: Generate Proposals

Run the improvement proposal generator to analyze recent user queries and
produce new proposals. This calls Claude to identify patterns and gaps.

```bash
cd pkgs/agent && bun run improve
```

If the user says proposals already exist or asks to skip generation, go
directly to Phase 2.

After running, report how many new proposals were created.

---

## Phase 2: Gather Context

Query the database for proposals and supporting analytics. Use the Supabase MCP
connection or `psql` to run these queries.

### 2a. Pending proposals

```sql
SELECT id, difficulty, category, title, description, evidence, query_count, created_at
FROM improvement_proposals
WHERE status = 'proposed'
ORDER BY query_count DESC, created_at DESC;
```

### 2b. Analytics summary (last 7 days)

```sql
SELECT
  COUNT(*)                                    AS total_queries,
  COUNT(*) FILTER (WHERE error)               AS error_count,
  ROUND(AVG(latency_ms))                      AS avg_latency_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)) AS p95_latency_ms,
  COUNT(DISTINCT session_id)                  AS unique_sessions
FROM user_queries
WHERE created_at > now() - interval '7 days';
```

### 2c. Tool usage breakdown

```sql
SELECT tool_name, SUM(usage_count) AS total_uses
FROM v_query_tool_usage
WHERE usage_date > now() - interval '7 days'
GROUP BY tool_name
ORDER BY total_uses DESC;
```

### 2d. Error queries (last 7 days)

```sql
SELECT id, user_message, tools_used, latency_ms, created_at
FROM user_queries
WHERE error = true AND created_at > now() - interval '7 days'
ORDER BY created_at DESC
LIMIT 20;
```

### 2e. Latency outliers (>5s, last 7 days)

```sql
SELECT id, user_message, tool_count, latency_ms, created_at
FROM user_queries
WHERE latency_ms > 5000 AND created_at > now() - interval '7 days'
ORDER BY latency_ms DESC
LIMIT 20;
```

### 2f. Recent query themes

```sql
SELECT user_message, tool_count, latency_ms, error, created_at
FROM user_queries
WHERE created_at > now() - interval '3 days'
ORDER BY created_at DESC
LIMIT 50;
```

---

## Phase 3: Analyze & Score

Score each proposal on four axes (weights in parentheses):

| Axis | Weight | 1 (Low) | 3 (Medium) | 5 (High) |
| ---- | ------ | ------- | ---------- | -------- |
| **Impact** | 40% | Cosmetic / rare edge case | Improves common workflow | Fixes frequent failure or unlocks new capability |
| **Feasibility** | 30% | Multi-file refactor, new dependencies | Moderate edit, well-scoped | Single-file change, <20 lines |
| **Evidence** | 20% | Theoretical, no query data | Some supporting queries | Clear pattern in errors/latency/usage |
| **Risk** | 10% | Could break existing behavior | Minor regression possible | No risk, purely additive |

**Composite score** = `(impact × 0.4) + (feasibility × 0.3) + (evidence × 0.2) + (risk × 0.1)`

Cross-reference proposals against the analytics data gathered in Phase 2:

- Proposals addressing errors found in 2d get an evidence boost
- Proposals addressing latency outliers from 2e get an evidence boost
- Proposals for tools with high usage (2c) get an impact boost

---

## Phase 4: Present Plan & Wait for Approval

Organize scored proposals into tiers and present to the developer:

### Tier format

**Quick Wins** (score ≥ 3.5, feasibility ≥ 4)
Changes that are easy and high-value. Implement first.

**High Impact** (score ≥ 3.5, feasibility < 4)
Significant improvements that require more effort.

**Strategic** (score 2.5–3.4)
Worth doing but lower priority.

**Skip** (score < 2.5)
Not worth implementing now. Briefly explain why.

### Present each proposal as

```markdown
### [Tier] #<id>: <title>
- **Category:** <category> | **Difficulty:** <difficulty>
- **Score:** <composite> (I:<n> F:<n> E:<n> R:<n>)
- **Evidence:** <evidence summary>
- **What to change:** <specific files and nature of change>
- **Risk:** <what could go wrong>
```

### APPROVAL GATE

After presenting the plan, **stop and ask the developer**:

> Here's the improvement plan. Which proposals should I implement?
> You can approve all, pick specific IDs, or skip.

**Do not proceed to Phase 5 until the developer responds.**

---

## Phase 5: Implement Changes

For each approved proposal, make targeted code changes to the agent. Use the
category → file mapping below to know where each type of change lands.

### Category → File Mapping

| Category | Primary Files | What Changes |
| -------- | ------------- | ------------ |
| **tool** | `pkgs/agent/src/tools.ts` | Add/modify tool definitions, parameters, descriptions, validation, or output formatting |
| **prompt** | `pkgs/agent/src/system-prompt.ts` | Refine system prompt instructions, add analysis patterns, improve response templates |
| **ux** | `pkgs/agent/src/agent.ts`, `pkgs/agent/src/server.ts` | Improve conversation flow, streaming, error messages, response formatting |
| **data** | `pkgs/agent/src/tools.ts`, `pkgs/ingestion/sql/*.sql` | Add/improve SQL queries in tools, add database views, fix data access patterns |
| **performance** | `pkgs/agent/src/agent.ts`, `pkgs/agent/src/tools.ts` | Reduce token usage, optimize tool calls, add caching, improve latency |

### Implementation guidelines

- **Read before editing.** Always read the target file first to understand
  current state.
- **Minimal diffs.** Change only what the proposal requires. Don't refactor
  surrounding code.
- **Preserve behavior.** Existing tools and prompt patterns must keep working
  unless the proposal explicitly replaces them.
- **Test mentally.** After each edit, consider: would the agent still handle
  existing query types correctly?

---

## Phase 6: Deploy

After all approved changes are implemented, run the deploy pipeline:

### 6a. Validate

```bash
pnpm run lint:fix
pnpm run typecheck
```

Fix any errors before proceeding. If lint or typecheck fails, fix the issues
and re-run until clean.

### 6b. Commit

Create a conventional commit with the list of implemented proposal IDs:

```bash
git add -A
git commit -m "feat(agent): implement self-improvement proposals #<ids>

Proposals implemented:
- #<id>: <title>
- #<id>: <title>

Generated from user query analysis via /self-improve.

Signed-off-by: ..."
```

### 6c. Deploy

```bash
deploy/deploy.sh
```

Report the Cloud Run URL from the deploy output.

### 6d. Mark proposals as implemented

For each implemented proposal, update its status in the database:

```sql
UPDATE improvement_proposals
SET status = 'implemented'
WHERE id IN (<comma-separated ids>);
```

---

## DB Schema Reference

### improvement_proposals

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | `BIGINT` | Auto-generated identity |
| `difficulty` | `TEXT` | `easy`, `medium`, or `hard` |
| `category` | `TEXT` | `tool`, `prompt`, `ux`, `data`, or `performance` |
| `title` | `TEXT` | Short proposal title |
| `description` | `TEXT` | Full description of the change |
| `evidence` | `TEXT` | Supporting evidence from query patterns |
| `status` | `TEXT` | `proposed`, `accepted`, `rejected`, or `implemented` |
| `query_count` | `INTEGER` | Number of related queries |
| `created_at` | `TIMESTAMPTZ` | When the proposal was generated |

### user_queries

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | `BIGINT` | Auto-generated identity |
| `session_id` | `TEXT` | Groups queries by session |
| `user_message` | `TEXT` | The user's input |
| `assistant_response` | `TEXT` | The agent's response |
| `tools_used` | `JSONB` | Array of tool names used |
| `tool_count` | `INTEGER` | Number of tools invoked |
| `latency_ms` | `INTEGER` | End-to-end response time |
| `error` | `BOOLEAN` | Whether the query errored |
| `created_at` | `TIMESTAMPTZ` | Timestamp |
