export interface DbEvent {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	category: string | null;
	start_date: string | null;
	end_date: string | null;
	active: boolean;
	closed: boolean;
	liquidity: number;
	volume: number;
	tags: unknown;
	raw_data: unknown;
	created_at: string;
	updated_at: string;
}

export interface DbMarket {
	id: string;
	event_id: string | null;
	slug: string | null;
	question: string;
	description: string | null;
	outcome_yes: string | null;
	outcome_no: string | null;
	token_id_yes: string | null;
	token_id_no: string | null;
	active: boolean;
	closed: boolean;
	liquidity: number;
	volume: number;
	best_bid: number | null;
	best_ask: number | null;
	last_price: number | null;
	raw_data: unknown;
	created_at: string;
	updated_at: string;
}

export interface DbPriceSnapshot {
	id?: number;
	market_id: string;
	token_id: string;
	price: number;
	midpoint: number | null;
	spread: number | null;
	bid_depth: number | null;
	ask_depth: number | null;
	volume_24h: number | null;
	snapshot_at: string;
}
