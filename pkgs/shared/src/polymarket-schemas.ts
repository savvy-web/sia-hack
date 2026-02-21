import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Transform a JSON-encoded string into a parsed value.
 * Polymarket encodes several array fields as JSON strings
 * (e.g. `outcomes`, `outcomePrices`, `clobTokenIds`).
 */
const jsonStringArray = z.string().transform((val) => JSON.parse(val) as string[]);

const jsonStringNumberArray = z
	.string()
	.transform((val) => JSON.parse(val) as string[])
	.transform((arr) => arr.map(Number));

// ---------------------------------------------------------------------------
// Gamma Tag
// ---------------------------------------------------------------------------

export const GammaTagSchema = z
	.object({
		id: z.string().optional(),
		label: z.string().optional(),
		slug: z.string().optional(),
	})
	.passthrough();

export type GammaTag = z.infer<typeof GammaTagSchema>;

// ---------------------------------------------------------------------------
// Gamma Market  (/markets on gamma-api)
// ---------------------------------------------------------------------------

export const GammaMarketSchema = z
	.object({
		// Identity
		id: z.string(),
		question: z.string().optional(),
		conditionId: z.string().optional(),
		slug: z.string().optional(),
		description: z.string().optional(),

		// Outcomes  -- JSON-encoded strings
		outcomes: jsonStringArray.optional(),
		outcomePrices: jsonStringNumberArray.optional(),
		clobTokenIds: jsonStringArray.optional(),

		// Volume & liquidity are STRINGS on gamma markets
		volume: z.string().optional(),
		liquidity: z.string().optional(),

		// Numeric counterparts
		volumeNum: z.number().optional(),
		liquidityNum: z.number().optional(),

		// Status flags
		active: z.boolean().optional(),
		closed: z.boolean().optional(),
		archived: z.boolean().optional(),
		restricted: z.boolean().optional(),

		// Pricing
		bestBid: z.number().optional(),
		bestAsk: z.number().optional(),
		lastTradePrice: z.number().optional(),
		spread: z.number().optional(),

		// Price changes
		oneDayPriceChange: z.number().optional(),
		oneHourPriceChange: z.number().optional(),
		oneWeekPriceChange: z.number().optional(),

		// Volume windows
		volume24hr: z.number().optional(),

		// Parent events (summary objects when fetched via /markets)
		events: z.array(z.unknown()).optional(),
	})
	.passthrough();

export type GammaMarket = z.infer<typeof GammaMarketSchema>;

// ---------------------------------------------------------------------------
// Gamma Event  (/events on gamma-api)
// ---------------------------------------------------------------------------

export const GammaEventSchema = z
	.object({
		// Identity
		id: z.string(),
		ticker: z.string().optional(),
		slug: z.string().optional(),
		title: z.string().optional(),
		description: z.string().optional(),
		resolutionSource: z.string().optional(),

		// Dates (ISO strings)
		startDate: z.string().optional(),
		creationDate: z.string().optional(),
		endDate: z.string().optional(),

		// Images
		image: z.string().optional(),
		icon: z.string().optional(),

		// Status flags
		active: z.boolean().optional(),
		closed: z.boolean().optional(),
		archived: z.boolean().optional(),
		new: z.boolean().optional(),
		featured: z.boolean().optional(),
		restricted: z.boolean().optional(),

		// Numeric aggregates
		liquidity: z.number().optional(),
		volume: z.number().optional(),
		openInterest: z.number().optional(),
		volume24hr: z.number().optional(),
		volume1wk: z.number().optional(),
		volume1mo: z.number().optional(),
		volume1yr: z.number().optional(),
		liquidityClob: z.number().optional(),

		// Metadata
		category: z.string().optional(),
		commentCount: z.number().optional(),
		enableNegRisk: z.boolean().optional(),

		// Nested
		markets: z.array(GammaMarketSchema).optional(),
		tags: z.array(GammaTagSchema).optional(),
	})
	.passthrough();

export type GammaEvent = z.infer<typeof GammaEventSchema>;

// ---------------------------------------------------------------------------
// CLOB Token (nested inside CLOB Market)
// ---------------------------------------------------------------------------

export const ClobTokenSchema = z
	.object({
		token_id: z.string(),
		outcome: z.string().optional(),
		price: z.number().optional(),
		winner: z.boolean().optional(),
	})
	.passthrough();

export type ClobToken = z.infer<typeof ClobTokenSchema>;

// ---------------------------------------------------------------------------
// CLOB Market  (clob.polymarket.com/markets)
// ---------------------------------------------------------------------------

export const ClobMarketSchema = z
	.object({
		condition_id: z.string(),
		question_id: z.string().optional(),
		question: z.string().optional(),
		description: z.string().optional(),
		market_slug: z.string().optional(),
		end_date_iso: z.string().optional(),

		// Status flags
		active: z.boolean().optional(),
		closed: z.boolean().optional(),
		archived: z.boolean().optional(),

		// Tokens
		tokens: z.array(ClobTokenSchema).optional(),

		// Risk
		neg_risk: z.boolean().optional(),

		// Order sizing
		minimum_order_size: z.number().optional(),
		minimum_tick_size: z.number().optional(),
	})
	.passthrough();

export type ClobMarket = z.infer<typeof ClobMarketSchema>;

// ---------------------------------------------------------------------------
// CLOB paginated response wrapper
// ---------------------------------------------------------------------------

export const ClobPaginatedResponseSchema = z
	.object({
		data: z.array(ClobMarketSchema).optional(),
		next_cursor: z.string().optional(),
		limit: z.number().optional(),
		count: z.number().optional(),
	})
	.passthrough();

export type ClobPaginatedResponse = z.infer<typeof ClobPaginatedResponseSchema>;
