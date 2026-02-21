# Changelog

All notable changes to the Oracle agent are documented here.

## [Unreleased]

### Self-Improvement Cycle 2 — 2026-02-21

Proposals generated from 17 user queries (7 sessions) via `/self-improve`.

#### Prompt Improvements

- **Scope & gambling guardrails** (#7) — Overfit now clearly defines its scope
  (Polymarket only) and fast-deflects casino/poker/sports betting questions with
  a charming 1-sentence redirect instead of burning 6-13s deliberating.
- **Jailbreak resistance** (#8) — Identity anchoring added. Overfit laughs off
  persona override attempts (fiduciary, unicorn, pink pony, blackmail) in one
  sentence and redirects to markets.
- **Named entity resolution** (#13) — When users mention people/events (Trump,
  JD Vance, Ronaldo), Overfit now searches for them as market keywords via
  ILIKE queries instead of guessing.

#### Performance

- **Out-of-scope fast-accept** (#12) — The no-tool guard now recognizes quick
  deflection responses (out-of-scope redirects, identity assertions) and lets
  them through immediately instead of nudging for tool use. Reduces latency
  on off-topic queries from 6-13s to under 3s.

### Self-Improvement Cycle 1 — 2026-02-21

Proposals generated from user query analysis via `/self-improve`.

#### New Tools

- **`analyze_order_flow`** (#1) — Analyzes order book bid/ask imbalance, depth
  concentration, and thin-side detection to identify potential uninformed
  ("dumb money") vs informed ("smart money") positioning.
- **`detect_mispricing`** (#4) — Compares implied probabilities across markets
  within an event (checks if they sum to ~100%) and compares DB snapshot prices
  vs live CLOB prices to find stale or divergent pricing.

#### Prompt Improvements

- **Ambiguous market reference handling** (#2) — Oracle now asks a clarifying
  question when users say "this market" or "the market" without specifying which
  one, instead of stalling or guessing.
- **Trading jargon glossary** (#5) — System prompt now maps common financial
  slang (dumb money, smart money, fading, bagholders, exit liquidity, mispriced,
  rug, moon, whale) to concrete analytical tool calls.

#### Performance

- **No-tool response guard** (#3) — When the model's first response uses no
  tools and is short/vague, the agent now nudges it to either use tools for
  data-backed answers or ask a clarifying question, reducing 40s+ deadlocks.

#### Bug Fixes

- Fixed `improve.ts` crash when `tools_used` column contains a scalar instead
  of a JSON array (added `jsonb_typeof` guard).
