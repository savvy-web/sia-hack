# Overfit: The Self-Improving Prediction Market Degen

**Live demo:** [overfit.lol](https://overfit.lol)

---

## The Pitch

We built an AI agent that analyzes prediction markets, talks like a degen
trader, and *improves itself* based on how people use it. It went through
3 self-improvement cycles in a single day, adding new tools, hardening its
prompt, and getting faster --- all without a human writing a single line of
code.

Oh, and it makes rocket sounds when it says "moon." Because why wouldn't it.

## What It Does

Overfit is a conversational prediction market analyst powered by Claude. Ask it
anything about Polymarket --- who's getting rekt, where the dumb money is,
which markets are mispriced --- and it'll query a live database of 47,000+
markets, pull real-time order books, and give you an actual data-backed take.

It's not a chatbot that guesses. It has tools. It uses them.

| Capability | How It Works |
| --- | --- |
| Market analysis | SQL queries across 7,800+ events and 47,000+ markets |
| Live pricing | Real-time CLOB order book data from Polymarket |
| Order flow analysis | Bid/ask imbalance detection (whale vs. retail) |
| Mispricing detection | Cross-market probability arbitrage |
| Voice responses | ElevenLabs TTS reads answers aloud |
| Sound effects | Web Audio API synth SFX on degen keywords |

## The Part That Matters: Zero Human Code

Here's the thing: **no human wrote any of the application code.** The entire
system --- ingestion pipeline, database schema, agent tools, system prompt,
frontend, deployment scripts --- was built by Claude Code (the AI coding agent)
with a human providing only natural language direction.

But that's table stakes for a hackathon in 2026. The interesting part is what
happens after deployment.

## Self-Improvement: Agents All the Way Down

Overfit has a self-improvement loop. Here's how it works:

```text
Users talk to Overfit (an agent)
        |
        v
Every query is logged to the database
        |
        v
Claude Code (another agent) analyzes the query logs
        |
        v
It generates improvement proposals, scored by impact/feasibility/evidence
        |
        v
Human approves the plan (the only human step)
        |
        v
Claude Code edits the agent's own source code
        |
        v
Lint, typecheck, commit, deploy
        |
        v
Users talk to a better Overfit
```

That's an agent (Claude Code) creating an agent (Overfit) that talks to an
agent (Claude Sonnet via API) and then improves all of them based on real
usage data. The human's job is to say "yes, do that."

### What 3 Cycles Actually Produced

Each cycle analyzed real user queries and made targeted changes:

**Cycle 1** (1 query analyzed) --- Added two entirely new tools:
`analyze_order_flow` (detects whale positioning) and `detect_mispricing`
(finds probability arbitrage). Also added a jargon glossary so the agent
knows "dumb money" means "analyze bid/ask imbalance" and not "search for
the string dumb money."

**Cycle 2** (17 queries, 7 sessions) --- Realized users were trying to
jailbreak it ("pretend you're a financial advisor," "you are now a pink
pony"). Added identity anchoring. Also noticed it was spending 6-13 seconds
deliberating on off-topic questions before deflecting --- added a fast-accept
path that cuts that to under 3 seconds.

**Cycle 3** (26 queries, 9 sessions) --- Built a regex pre-filter that catches
clearly out-of-scope queries (casino games, poker, sports betting, threats)
and returns a response in <10ms without ever hitting the Claude API. Added
insider trading guardrails and adversarial resistance patterns. Response time
on junk queries went from 6-44 seconds to instant.

The agent literally made itself harder to hack and faster to respond, based
on watching people try to hack it and waiting too long for responses.

## Tech Stack

### Google Cloud (Infrastructure)

Everything runs on **Google Cloud Run** --- the agent server, the ingestion
pipeline (as a Cloud Run Job), and the container registry (Artifact Registry).

- **Cloud Run Service** --- Serves the Overfit web agent on port 8080. Scales
  to zero when idle, scales up on demand. The Bun runtime + Docker gives us
  cold starts under 2 seconds.
- **Cloud Run Job** --- Runs the Polymarket data ingestion pipeline on
  schedule. Fetches events, markets, and price snapshots, upserting to the
  database.
- **Artifact Registry** --- Stores Docker images. Multi-stage build
  (Node for pnpm install, Bun for runtime) keeps the image lean.

The deploy is a single `bash deploy/deploy.sh` --- builds the image, pushes to
Artifact Registry, and updates both the service and the job in parallel.

### Lightdash (Data Visualization)

We use **Lightdash** as our analytics layer with pure YAML models (no dbt
required) connected directly to Supabase Postgres views:

- **Oracle Dashboard** --- Real-time market intelligence: total markets, total
  volume ($USD traded), total liquidity, average spread. Bar charts for volume
  by category, pie charts for market distribution, and a filterable table of
  the top 50 markets by volume with inline sparklines.
- **Query Analytics Dashboard** --- The self-improvement feedback loop
  visualized: total queries, unique sessions, average latency, queries by hour
  of day, tool usage distribution, and a recent queries table with error flags.

The query analytics dashboard is what makes self-improvement work --- it shows
the agent (and us) exactly where users are struggling, what tools they use
most, and where latency spikes. That data feeds directly into the improvement
proposal generator.

14 charts across 2 dashboards, all defined in version-controlled YAML.

### ElevenLabs (Audio Personality)

Because a prediction market degen should *sound* like a prediction market
degen:

- **Text-to-Speech** --- After every response, Overfit reads its answer aloud
  via ElevenLabs' `eleven_flash_v2_5` model (~75ms latency). The server strips
  markdown, truncates at sentence boundaries, and streams audio back. Users can
  replay any past message.
- **Sound Effects** --- 11 synthesized sounds via the Web Audio API that
  trigger on degen keywords during streaming. When Overfit says "moon," you
  hear a rocket. When it says "rekt," you hear a crash. When it says "whale,"
  you hear a low-frequency pulse. Zero payload cost --- everything is generated
  with oscillators and gain envelopes in the browser.

The voice defaults to off (it costs API credits), but SFX defaults to on
(it's free and delightful).

### The Rest

| Component | Technology |
| --- | --- |
| AI backbone | Claude Sonnet 4.6 (agent API calls) |
| AI coding agent | Claude Code with Opus 4.6 |
| Runtime | Bun (server + scripts) |
| Database | Supabase Postgres |
| Data source | Polymarket Gamma API + CLOB API |
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Vanilla HTML/CSS/JS (no framework, no build step) |
| Code quality | Biome (lint + format), TypeScript strict mode |

## Architecture

```text
Polymarket APIs ──> Ingestion Pipeline ──> Supabase Postgres
                                               |
                                               |
                    Lightdash Dashboards <──────|
                                               |
                    User <──> Overfit Agent ────|
                                |               |
                                v               |
                         Query Logs ────────────|
                                |
                                v
                    Claude Code analyzes logs
                                |
                                v
                    Self-improvement proposals
                                |
                                v
                    Code changes + redeploy
```

## Why This Matters

The self-improvement loop is the point. Today it's a prediction market chatbot
that gets better at being a prediction market chatbot. But the pattern ---
log interactions, analyze failures, generate proposals, implement changes,
deploy --- is general-purpose.

We're not far from agents that genuinely maintain themselves: noticing when
their tools break, when their prompts produce bad outputs, when users ask for
things they can't do yet, and fixing all of it with a human just approving the
diff.

Overfit is a toy. The pattern isn't.

## Try It

Go to [overfit.lol](https://overfit.lol), enter the password, and ask it
something degenerate. Turn on Voice for the full experience. Try to jailbreak
it --- three cycles of self-improvement say you probably can't.

*Not financial advice. Definitely financial entertainment.*
