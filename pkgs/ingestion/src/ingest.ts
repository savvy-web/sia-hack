/**
 * Main ingestion script: fetches all active events and markets from Polymarket,
 * upserts them into Supabase, and captures price snapshots.
 *
 * Usage: bun run src/ingest.ts
 */
import type { GammaEvent, GammaMarket } from "@savvy-web/oracle-shared";
import { sql } from "./db.js";
import { fetchAllActiveEvents, fetchClobPrice, fetchOrderBookDepth } from "./polymarket.js";

const UPSERT_BATCH_SIZE = 50;
const SNAPSHOT_BATCH_SIZE = 20;
const RATE_LIMIT_MS = 100;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertEventsBatch(events: GammaEvent[]): Promise<number> {
	if (events.length === 0) return 0;

	const values = events.map((e) => ({
		id: e.id,
		slug: e.slug ?? null,
		title: e.title ?? "Untitled",
		description: e.description ?? null,
		category: e.category ?? null,
		start_date: e.startDate ?? null,
		end_date: e.endDate ?? null,
		active: e.active ?? true,
		closed: e.closed ?? false,
		liquidity: e.liquidity ?? 0,
		volume: e.volume ?? 0,
		tags: JSON.stringify(e.tags ?? []),
		raw_data: JSON.stringify(e),
	}));

	await sql`
		INSERT INTO events ${sql(values)}
		ON CONFLICT (id) DO UPDATE SET
			slug = EXCLUDED.slug,
			title = EXCLUDED.title,
			description = EXCLUDED.description,
			category = EXCLUDED.category,
			start_date = EXCLUDED.start_date,
			end_date = EXCLUDED.end_date,
			active = EXCLUDED.active,
			closed = EXCLUDED.closed,
			liquidity = EXCLUDED.liquidity,
			volume = EXCLUDED.volume,
			tags = EXCLUDED.tags,
			raw_data = EXCLUDED.raw_data
	`;
	return events.length;
}

async function upsertMarketsBatch(markets: GammaMarket[], eventId: string): Promise<number> {
	if (markets.length === 0) return 0;

	const values = markets.map((m) => {
		const outcomes = m.outcomes ?? ["Yes", "No"];
		const tokenIds = m.clobTokenIds ?? [];
		return {
			id: m.id,
			event_id: eventId,
			slug: m.slug ?? null,
			question: m.question ?? "Unknown",
			description: m.description ?? null,
			outcome_yes: outcomes[0] ?? "Yes",
			outcome_no: outcomes[1] ?? "No",
			token_id_yes: tokenIds[0] ?? null,
			token_id_no: tokenIds[1] ?? null,
			active: m.active ?? true,
			closed: m.closed ?? false,
			liquidity: m.liquidityNum ?? 0,
			volume: m.volumeNum ?? 0,
			best_bid: m.bestBid ?? null,
			best_ask: m.bestAsk ?? null,
			last_price: m.lastTradePrice ?? null,
			raw_data: JSON.stringify(m),
		};
	});

	await sql`
		INSERT INTO markets ${sql(values)}
		ON CONFLICT (id) DO UPDATE SET
			event_id = EXCLUDED.event_id,
			slug = EXCLUDED.slug,
			question = EXCLUDED.question,
			description = EXCLUDED.description,
			outcome_yes = EXCLUDED.outcome_yes,
			outcome_no = EXCLUDED.outcome_no,
			token_id_yes = EXCLUDED.token_id_yes,
			token_id_no = EXCLUDED.token_id_no,
			active = EXCLUDED.active,
			closed = EXCLUDED.closed,
			liquidity = EXCLUDED.liquidity,
			volume = EXCLUDED.volume,
			best_bid = EXCLUDED.best_bid,
			best_ask = EXCLUDED.best_ask,
			last_price = EXCLUDED.last_price,
			raw_data = EXCLUDED.raw_data
	`;
	return markets.length;
}

interface TokenToSnapshot {
	marketId: string;
	tokenId: string;
}

async function captureSnapshots(tokens: TokenToSnapshot[]): Promise<number> {
	let count = 0;
	console.log(`  Capturing price snapshots for ${tokens.length} tokens...`);

	for (let i = 0; i < tokens.length; i += SNAPSHOT_BATCH_SIZE) {
		const batch = tokens.slice(i, i + SNAPSHOT_BATCH_SIZE);

		const rows: Array<{
			market_id: string;
			token_id: string;
			price: number;
			midpoint: number | null;
			spread: number | null;
			bid_depth: number | null;
			ask_depth: number | null;
		}> = [];

		const results = await Promise.allSettled(
			batch.map(async ({ marketId, tokenId }) => {
				const [price, depth] = await Promise.all([fetchClobPrice(tokenId), fetchOrderBookDepth(tokenId)]);
				if (price.price !== null) {
					rows.push({
						market_id: marketId,
						token_id: tokenId,
						price: price.price,
						midpoint: price.midpoint,
						spread: price.spread,
						bid_depth: depth.bidDepth,
						ask_depth: depth.askDepth,
					});
				}
			}),
		);

		if (rows.length > 0) {
			await sql`INSERT INTO price_snapshots ${sql(rows)}`;
			count += rows.length;
		}

		const failures = results.filter((r) => r.status === "rejected");
		if (failures.length > 0) {
			console.warn(`  ${failures.length} snapshot(s) failed in batch`);
		}

		if (i + SNAPSHOT_BATCH_SIZE < tokens.length) {
			process.stdout.write(`\r  Snapshots: ${count}/${tokens.length} captured...`);
			await sleep(RATE_LIMIT_MS);
		}
	}
	console.log("");
	return count;
}

async function main(): Promise<void> {
	const startTime = Date.now();
	console.log("=== Oracle Ingestion ===");
	console.log(`Started at ${new Date().toISOString()}\n`);

	// Step 1: Fetch all active events (includes embedded markets)
	console.log("[1/3] Fetching events + markets from Polymarket...");
	const events = await fetchAllActiveEvents();
	console.log(`  Found ${events.length} active events\n`);

	// Step 2: Upsert into Supabase in batches
	console.log("[2/3] Upserting into Supabase...");
	let eventCount = 0;
	let marketCount = 0;
	const allTokens: TokenToSnapshot[] = [];

	for (let i = 0; i < events.length; i += UPSERT_BATCH_SIZE) {
		const eventBatch = events.slice(i, i + UPSERT_BATCH_SIZE);
		eventCount += await upsertEventsBatch(eventBatch);

		for (const event of eventBatch) {
			const markets = event.markets ?? [];
			if (markets.length > 0) {
				marketCount += await upsertMarketsBatch(markets, event.id);
			}

			for (const market of markets) {
				const tokenIds = market.clobTokenIds ?? [];
				for (const tokenId of tokenIds) {
					allTokens.push({ marketId: market.id, tokenId });
				}
			}
		}

		process.stdout.write(`\r  Upserted ${eventCount} events, ${marketCount} markets...`);
	}
	console.log(`\n  Done: ${eventCount} events, ${marketCount} markets\n`);

	// Step 3: Capture price snapshots (only for markets with token IDs)
	let snapshotCount = 0;
	if (process.env.SKIP_SNAPSHOTS === "true") {
		console.log("[3/3] Skipping price snapshots (SKIP_SNAPSHOTS=true)\n");
	} else {
		console.log("[3/3] Capturing price snapshots...");
		snapshotCount = await captureSnapshots(allTokens);
		console.log(`  Captured ${snapshotCount} price snapshots\n`);
	}

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log("=== Done ===");
	console.log(`Events: ${eventCount} | Markets: ${marketCount} | Snapshots: ${snapshotCount}`);
	console.log(`Elapsed: ${elapsed}s`);

	await sql.end();
}

main().catch(async (err) => {
	console.error("Ingestion failed:", err);
	await sql.end();
	process.exit(1);
});
