import type { GammaEvent, GammaMarket } from "@savvy-web/oracle-shared";
import { GammaEventSchema, GammaMarketSchema } from "@savvy-web/oracle-shared";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";

const RATE_LIMIT_MS = 200;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} for ${url}: ${await res.text()}`);
	}
	return res.json() as Promise<T>;
}

/** Fetch all active events with their embedded markets from Gamma API. */
export async function fetchAllActiveEvents(): Promise<GammaEvent[]> {
	const allEvents: GammaEvent[] = [];
	let offset = 0;
	const limit = 100;

	console.log("  Fetching active events from Gamma API...");

	while (true) {
		const url = `${GAMMA_BASE}/events?active=true&closed=false&limit=${limit}&offset=${offset}`;
		const raw = await fetchJson<unknown[]>(url);

		if (!raw || raw.length === 0) break;

		for (const item of raw) {
			const parsed = GammaEventSchema.safeParse(item);
			if (parsed.success) {
				allEvents.push(parsed.data);
			} else {
				console.warn(`  Skipping event (parse error): ${JSON.stringify(parsed.error.issues[0])}`);
			}
		}

		console.log(`  ... fetched ${allEvents.length} events so far (offset=${offset})`);

		if (raw.length < limit) break;
		offset += limit;
		await sleep(RATE_LIMIT_MS);
	}

	return allEvents;
}

/** Fetch all active markets from Gamma API (without event nesting). */
export async function fetchAllActiveMarkets(): Promise<GammaMarket[]> {
	const allMarkets: GammaMarket[] = [];
	let offset = 0;
	const limit = 100;

	console.log("  Fetching active markets from Gamma API...");

	while (true) {
		const url = `${GAMMA_BASE}/markets?active=true&closed=false&limit=${limit}&offset=${offset}`;
		const raw = await fetchJson<unknown[]>(url);

		if (!raw || raw.length === 0) break;

		for (const item of raw) {
			const parsed = GammaMarketSchema.safeParse(item);
			if (parsed.success) {
				allMarkets.push(parsed.data);
			} else {
				console.warn(`  Skipping market (parse error): ${JSON.stringify(parsed.error.issues[0])}`);
			}
		}

		console.log(`  ... fetched ${allMarkets.length} markets so far (offset=${offset})`);

		if (raw.length < limit) break;
		offset += limit;
		await sleep(RATE_LIMIT_MS);
	}

	return allMarkets;
}

/** Fetch CLOB price data for a single token. */
export async function fetchClobPrice(tokenId: string): Promise<{
	price: number | null;
	midpoint: number | null;
	spread: number | null;
}> {
	try {
		const [priceRes, midpointRes, spreadRes] = await Promise.all([
			fetchJson<{ price: string }>(`${CLOB_BASE}/price?token_id=${tokenId}&side=buy`),
			fetchJson<{ mid: string }>(`${CLOB_BASE}/midpoint?token_id=${tokenId}`),
			fetchJson<{ spread: string }>(`${CLOB_BASE}/spread?token_id=${tokenId}`),
		]);
		return {
			price: priceRes.price ? Number(priceRes.price) : null,
			midpoint: midpointRes.mid ? Number(midpointRes.mid) : null,
			spread: spreadRes.spread ? Number(spreadRes.spread) : null,
		};
	} catch {
		return { price: null, midpoint: null, spread: null };
	}
}

/** Fetch order book depth for a single token. */
export async function fetchOrderBookDepth(tokenId: string): Promise<{
	bidDepth: number;
	askDepth: number;
}> {
	try {
		const book = await fetchJson<{
			bids: Array<{ price: string; size: string }>;
			asks: Array<{ price: string; size: string }>;
		}>(`${CLOB_BASE}/book?token_id=${tokenId}`);

		const bidDepth = (book.bids || []).reduce((sum, b) => sum + Number(b.size), 0);
		const askDepth = (book.asks || []).reduce((sum, a) => sum + Number(a.size), 0);
		return { bidDepth, askDepth };
	} catch {
		return { bidDepth: 0, askDepth: 0 };
	}
}
