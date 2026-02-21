import type Anthropic from "@anthropic-ai/sdk";
import { getDb } from "./db.js";

const CLOB_BASE = "https://clob.polymarket.com";
const GAMMA_BASE = "https://gamma-api.polymarket.com";

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const toolDefinitions: Anthropic.Tool[] = [
	{
		name: "query_database",
		description: `Run a read-only SQL query against the Polymarket database.

Tables:
- events (id, slug, title, description, category, active, closed, liquidity, volume, tags, created_at, updated_at)
- markets (id, event_id, slug, question, description, active, closed, liquidity, volume, best_bid, best_ask, last_price, token_id_yes, token_id_no, created_at, updated_at)
- price_snapshots (id, market_id, token_id, price, midpoint, spread, bid_depth, ask_depth, snapshot_at)
- user_queries (id, session_id, user_message, assistant_response, tools_used JSONB, tool_count, latency_ms, error, created_at)
- improvement_proposals (id, difficulty, category, title, description, evidence, status, query_count, created_at)

Views (use these for most queries):
- v_market_overview (market_id, market_slug, question, active, closed, liquidity, volume, best_bid, best_ask, last_price, outcome_yes, outcome_no, token_id_yes, token_id_no, market_created_at, market_updated_at, event_id, event_title, event_slug, event_volume, event_liquidity, event_start_date, event_end_date, primary_category, price_direction, spread)
  price_direction values: 'Likely Yes' (>0.65), 'Likely No' (<0.35), 'Even odds' (0.35-0.65), 'Unknown'
- v_top_volume_markets (same columns as v_market_overview, pre-sorted by volume DESC, active markets only)
- v_category_summary (category, market_count, active_market_count, total_volume, avg_volume, total_liquidity, avg_price)
- v_query_analytics (flattened user query data with tools_used_list, query_hour, query_date, message_length_bucket)
- v_query_tool_usage (tool_name, usage_count, usage_date)
- v_improvement_proposals (all proposal fields)

Only SELECT queries allowed. Results capped at 50 rows.`,
		input_schema: {
			type: "object" as const,
			properties: {
				sql: {
					type: "string",
					description: "The SELECT SQL query to execute",
				},
			},
			required: ["sql"],
		},
	},
	{
		name: "get_live_price",
		description:
			"Fetch current live price, midpoint, and spread for a Polymarket token from the CLOB API. Use token_id_yes or token_id_no from the database.",
		input_schema: {
			type: "object" as const,
			properties: {
				token_id: {
					type: "string",
					description: "The CLOB token ID to fetch prices for",
				},
			},
			required: ["token_id"],
		},
	},
	{
		name: "get_order_book",
		description:
			"Fetch the order book for a Polymarket token — shows bid/ask depth and top 10 orders on each side. Useful for assessing liquidity and directional pressure.",
		input_schema: {
			type: "object" as const,
			properties: {
				token_id: {
					type: "string",
					description: "The CLOB token ID to fetch order book for",
				},
			},
			required: ["token_id"],
		},
	},
	{
		name: "fetch_gamma_market",
		description:
			"Fetch fresh market data from Polymarket's Gamma API by market ID or slug. Returns the latest metadata including 1h/24h/1w price changes, volume windows, and current pricing. Useful for seeing recent changes not yet in the database.",
		input_schema: {
			type: "object" as const,
			properties: {
				market_id: {
					type: "string",
					description: "The market condition ID or slug",
				},
			},
			required: ["market_id"],
		},
	},
	{
		name: "analyze_order_flow",
		description: `Analyze order book flow imbalance for a Polymarket token to detect potential uninformed ("dumb money") vs informed ("smart money") positioning.

Returns:
- bid_ask_imbalance: ratio of bid depth to ask depth (>1 = more buying pressure, <1 = more selling pressure)
- thin_side: which side has less depth ("bid" or "ask") — thin side is where exits are harder
- top_heavy_bids/asks: whether large orders cluster near the top (informed) or are spread thin (retail)
- concentration_ratio: what % of total depth is in the top 3 orders (high = whale-dominated)
- flow_signal: a plain-English summary of the flow dynamics`,
		input_schema: {
			type: "object" as const,
			properties: {
				token_id: {
					type: "string",
					description: "The CLOB token ID to analyze order flow for",
				},
			},
			required: ["token_id"],
		},
	},
	{
		name: "detect_mispricing",
		description: `Compare implied probabilities across markets within the same event to detect potential mispricings. Finds markets where probabilities don't add up correctly or where one market's price diverges from related markets.

Can also compare a single market's database price vs live CLOB price to find stale/divergent pricing.

Returns: list of discrepancies with magnitude and direction.`,
		input_schema: {
			type: "object" as const,
			properties: {
				event_id: {
					type: "string",
					description:
						"The event ID to analyze. All markets under this event will be compared. Either event_id or market_id is required.",
				},
				market_id: {
					type: "string",
					description:
						"A single market ID to compare its DB price vs live CLOB price. Either event_id or market_id is required.",
				},
			},
			required: [],
		},
	},
	{
		name: "get_improvement_proposals",
		description:
			"Get self-improvement proposals that have been generated from analyzing user query patterns. Returns proposals classified by difficulty (easy/medium/hard) and category (tool/prompt/ux/data/performance). Use this when asked about how Oracle can be improved or what improvements have been suggested.",
		input_schema: {
			type: "object" as const,
			properties: {
				status: {
					type: "string",
					description: "Filter by status: proposed, accepted, rejected, implemented. Omit for all.",
				},
				difficulty: {
					type: "string",
					description: "Filter by difficulty: easy, medium, hard. Omit for all.",
				},
			},
			required: [],
		},
	},
];

// ---------------------------------------------------------------------------
// Tool Execution
// ---------------------------------------------------------------------------

export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
	switch (name) {
		case "query_database":
			return await queryDatabase(input.sql as string);
		case "get_live_price":
			return await getLivePrice(input.token_id as string);
		case "get_order_book":
			return await getOrderBook(input.token_id as string);
		case "fetch_gamma_market":
			return await fetchGammaMarket(input.market_id as string);
		case "analyze_order_flow":
			return await analyzeOrderFlow(input.token_id as string);
		case "detect_mispricing":
			return await detectMispricing(input.event_id as string | undefined, input.market_id as string | undefined);
		case "get_improvement_proposals":
			return await getImprovementProposals(input.status as string | undefined, input.difficulty as string | undefined);
		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` });
	}
}

// ---------------------------------------------------------------------------
// Tool Implementations
// ---------------------------------------------------------------------------

async function queryDatabase(sqlQuery: string): Promise<string> {
	const upper = sqlQuery.trim().toUpperCase();
	if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
		return JSON.stringify({ error: "Only SELECT queries are allowed." });
	}

	// Ensure LIMIT
	let query = sqlQuery.trim().replace(/;$/, "");
	if (!upper.includes("LIMIT")) {
		query += " LIMIT 50";
	}

	try {
		const db = getDb();
		const rows = await db.unsafe(query);
		const result = JSON.stringify({ row_count: rows.length, rows });
		// Truncate if response is too large for the context
		if (result.length > 12000) {
			return `${result.slice(0, 12000)}\n... [truncated, ${rows.length} total rows]`;
		}
		return result;
	} catch (err) {
		return JSON.stringify({
			error: `Query failed: ${(err as Error).message}`,
		});
	}
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	}
	return res.json() as Promise<T>;
}

async function getLivePrice(tokenId: string): Promise<string> {
	try {
		const [priceRes, midpointRes, spreadRes] = await Promise.all([
			fetchJson<{ price: string }>(`${CLOB_BASE}/price?token_id=${tokenId}&side=buy`),
			fetchJson<{ mid: string }>(`${CLOB_BASE}/midpoint?token_id=${tokenId}`),
			fetchJson<{ spread: string }>(`${CLOB_BASE}/spread?token_id=${tokenId}`),
		]);
		return JSON.stringify({
			price: priceRes.price ? Number(priceRes.price) : null,
			midpoint: midpointRes.mid ? Number(midpointRes.mid) : null,
			spread: spreadRes.spread ? Number(spreadRes.spread) : null,
		});
	} catch (err) {
		return JSON.stringify({
			error: `Failed to fetch price: ${(err as Error).message}`,
		});
	}
}

async function getOrderBook(tokenId: string): Promise<string> {
	try {
		const book = await fetchJson<{
			bids: Array<{ price: string; size: string }>;
			asks: Array<{ price: string; size: string }>;
		}>(`${CLOB_BASE}/book?token_id=${tokenId}`);

		const bids = (book.bids || []).slice(0, 10);
		const asks = (book.asks || []).slice(0, 10);

		const bidDepth = (book.bids || []).reduce((sum, b) => sum + Number(b.size), 0);
		const askDepth = (book.asks || []).reduce((sum, a) => sum + Number(a.size), 0);

		return JSON.stringify({
			bid_depth_total: Math.round(bidDepth * 100) / 100,
			ask_depth_total: Math.round(askDepth * 100) / 100,
			top_bids: bids.map((b) => ({
				price: Number(b.price),
				size: Number(b.size),
			})),
			top_asks: asks.map((a) => ({
				price: Number(a.price),
				size: Number(a.size),
			})),
		});
	} catch (err) {
		return JSON.stringify({
			error: `Failed to fetch order book: ${(err as Error).message}`,
		});
	}
}

async function getImprovementProposals(status?: string, difficulty?: string): Promise<string> {
	try {
		const db = getDb();
		let query = "SELECT * FROM v_improvement_proposals WHERE 1=1";
		const params: string[] = [];

		if (status) {
			params.push(status);
			query += ` AND status = $${params.length}`;
		}
		if (difficulty) {
			params.push(difficulty);
			query += ` AND difficulty = $${params.length}`;
		}
		query += " ORDER BY created_at DESC LIMIT 30";

		const rows = await db.unsafe(query, params);
		return JSON.stringify({ count: rows.length, proposals: rows });
	} catch (err) {
		return JSON.stringify({
			error: `Failed to fetch proposals: ${(err as Error).message}`,
		});
	}
}

async function analyzeOrderFlow(tokenId: string): Promise<string> {
	try {
		const book = await fetchJson<{
			bids: Array<{ price: string; size: string }>;
			asks: Array<{ price: string; size: string }>;
		}>(`${CLOB_BASE}/book?token_id=${tokenId}`);

		const bids = book.bids || [];
		const asks = book.asks || [];

		const bidDepth = bids.reduce((sum, b) => sum + Number(b.size), 0);
		const askDepth = asks.reduce((sum, a) => sum + Number(a.size), 0);
		const totalDepth = bidDepth + askDepth;

		if (totalDepth === 0) {
			return JSON.stringify({ error: "Empty order book — no liquidity to analyze." });
		}

		const imbalance = askDepth > 0 ? Math.round((bidDepth / askDepth) * 100) / 100 : bidDepth > 0 ? 999 : 1;
		const thinSide = bidDepth < askDepth ? "bid" : "ask";

		// Concentration: what % of depth is in top 3 orders on each side
		const top3Bids = bids.slice(0, 3).reduce((s, b) => s + Number(b.size), 0);
		const top3Asks = asks.slice(0, 3).reduce((s, a) => s + Number(a.size), 0);
		const bidConcentration = bidDepth > 0 ? Math.round((top3Bids / bidDepth) * 100) : 0;
		const askConcentration = askDepth > 0 ? Math.round((top3Asks / askDepth) * 100) : 0;

		// Build flow signal
		let signal = "";
		if (imbalance > 2) {
			signal = `Strong buying pressure (${imbalance}x more bid depth). `;
		} else if (imbalance < 0.5) {
			signal = `Strong selling pressure (${Math.round((1 / imbalance) * 100) / 100}x more ask depth). `;
		} else {
			signal = "Balanced order flow. ";
		}

		if (bidConcentration > 70 || askConcentration > 70) {
			const side = bidConcentration > askConcentration ? "bid" : "ask";
			signal += `Top 3 ${side} orders hold ${side === "bid" ? bidConcentration : askConcentration}% of ${side} depth — likely whale/informed positioning. `;
		}

		if (thinSide === "ask" && askDepth < bidDepth * 0.3) {
			signal += "Very thin ask side — limited exit liquidity for Yes holders.";
		} else if (thinSide === "bid" && bidDepth < askDepth * 0.3) {
			signal += "Very thin bid side — limited exit liquidity for No holders.";
		}

		return JSON.stringify({
			bid_depth: Math.round(bidDepth * 100) / 100,
			ask_depth: Math.round(askDepth * 100) / 100,
			bid_ask_imbalance: imbalance,
			thin_side: thinSide,
			bid_concentration_top3_pct: bidConcentration,
			ask_concentration_top3_pct: askConcentration,
			bid_order_count: bids.length,
			ask_order_count: asks.length,
			flow_signal: signal.trim(),
		});
	} catch (err) {
		return JSON.stringify({ error: `Failed to analyze order flow: ${(err as Error).message}` });
	}
}

async function detectMispricing(eventId: string | undefined, marketId: string | undefined): Promise<string> {
	try {
		const db = getDb();

		// Mode 1: Compare a single market's DB price vs live CLOB price
		if (marketId && !eventId) {
			const rows = await db.unsafe(
				"SELECT question, last_price, token_id_yes FROM v_market_overview WHERE market_id = $1 LIMIT 1",
				[marketId],
			);
			if (rows.length === 0) return JSON.stringify({ error: "Market not found." });

			const market = rows[0];
			const liveData = await fetchJson<{ price: string }>(
				`${CLOB_BASE}/price?token_id=${market.token_id_yes}&side=buy`,
			);
			const livePrice = Number(liveData.price);
			const dbPrice = Number(market.last_price);
			const delta = Math.round((livePrice - dbPrice) * 10000) / 10000;

			return JSON.stringify({
				question: market.question,
				db_price: dbPrice,
				live_price: livePrice,
				delta,
				stale: Math.abs(delta) > 0.03,
				note:
					Math.abs(delta) > 0.03
						? `Price moved ${delta > 0 ? "up" : "down"} ${Math.abs(Math.round(delta * 100))}pp since last DB snapshot.`
						: "Prices are in sync.",
			});
		}

		// Mode 2: Compare all markets within an event
		if (eventId) {
			const rows = await db.unsafe(
				"SELECT market_id, question, last_price, token_id_yes FROM v_market_overview WHERE event_id = $1 ORDER BY volume DESC LIMIT 20",
				[eventId],
			);
			if (rows.length === 0) return JSON.stringify({ error: "No markets found for this event." });

			// For multi-outcome events, Yes prices should sum to ~1.0
			const totalImpliedProb = rows.reduce((s, r) => s + Number(r.last_price), 0);
			const overround = Math.round((totalImpliedProb - 1) * 10000) / 10000;

			const markets = rows.map((r) => ({
				market_id: r.market_id,
				question: r.question,
				implied_prob: Number(r.last_price),
			}));

			return JSON.stringify({
				event_id: eventId,
				market_count: rows.length,
				total_implied_prob: Math.round(totalImpliedProb * 10000) / 10000,
				overround,
				overround_pct: `${Math.round(overround * 100)}%`,
				mispriced: Math.abs(overround) > 0.05,
				note:
					Math.abs(overround) > 0.05
						? `Implied probabilities sum to ${Math.round(totalImpliedProb * 100)}% (should be ~100%). ${overround > 0 ? "Overpriced" : "Underpriced"} by ${Math.abs(Math.round(overround * 100))}pp.`
						: "Probabilities are well-calibrated across markets.",
				markets,
			});
		}

		return JSON.stringify({ error: "Provide either event_id or market_id." });
	} catch (err) {
		return JSON.stringify({ error: `Failed to detect mispricing: ${(err as Error).message}` });
	}
}

async function fetchGammaMarket(marketId: string): Promise<string> {
	try {
		// Try by condition ID first, then by slug
		let url = `${GAMMA_BASE}/markets/${marketId}`;
		let res = await fetch(url);

		if (!res.ok && res.status === 404) {
			url = `${GAMMA_BASE}/markets?slug=${marketId}&limit=1`;
			res = await fetch(url);
		}

		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}

		const data = await res.json();
		const market = Array.isArray(data) ? data[0] : data;

		if (!market) {
			return JSON.stringify({ error: "Market not found" });
		}

		// Return a focused subset of fields
		return JSON.stringify({
			id: market.id,
			question: market.question,
			slug: market.slug,
			active: market.active,
			closed: market.closed,
			outcomes: market.outcomes,
			outcomePrices: market.outcomePrices,
			volume: market.volume,
			volumeNum: market.volumeNum,
			liquidity: market.liquidity,
			liquidityNum: market.liquidityNum,
			bestBid: market.bestBid,
			bestAsk: market.bestAsk,
			lastTradePrice: market.lastTradePrice,
			spread: market.spread,
			oneDayPriceChange: market.oneDayPriceChange,
			oneHourPriceChange: market.oneHourPriceChange,
			oneWeekPriceChange: market.oneWeekPriceChange,
			volume24hr: market.volume24hr,
			clobTokenIds: market.clobTokenIds,
		});
	} catch (err) {
		return JSON.stringify({
			error: `Failed to fetch market: ${(err as Error).message}`,
		});
	}
}
