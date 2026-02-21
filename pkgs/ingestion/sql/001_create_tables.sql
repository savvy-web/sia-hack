-- Oracle prediction market schema for Supabase (Postgres)
-- Migration: 001_create_tables

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  closed BOOLEAN DEFAULT false,
  liquidity NUMERIC DEFAULT 0,
  volume NUMERIC DEFAULT 0,
  tags JSONB DEFAULT '[]'::jsonb,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Markets table
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  slug TEXT,
  question TEXT NOT NULL,
  description TEXT,
  outcome_yes TEXT,
  outcome_no TEXT,
  token_id_yes TEXT,
  token_id_no TEXT,
  active BOOLEAN DEFAULT true,
  closed BOOLEAN DEFAULT false,
  liquidity NUMERIC DEFAULT 0,
  volume NUMERIC DEFAULT 0,
  best_bid NUMERIC,
  best_ask NUMERIC,
  last_price NUMERIC,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Price snapshots (time series)
CREATE TABLE IF NOT EXISTS price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT REFERENCES markets(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL,
  price NUMERIC NOT NULL,
  midpoint NUMERIC,
  spread NUMERIC,
  bid_depth NUMERIC,
  ask_depth NUMERIC,
  volume_24h NUMERIC,
  snapshot_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for time-series queries
CREATE INDEX IF NOT EXISTS idx_price_snapshots_market_time ON price_snapshots(market_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_token ON price_snapshots(token_id);
CREATE INDEX IF NOT EXISTS idx_markets_event ON markets(event_id);
CREATE INDEX IF NOT EXISTS idx_markets_active ON markets(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_events_active ON events(active) WHERE active = true;

-- Market comments
CREATE TABLE IF NOT EXISTS market_comments (
  id TEXT PRIMARY KEY,
  market_id TEXT REFERENCES markets(id) ON DELETE CASCADE,
  author TEXT,
  content TEXT,
  sentiment_score NUMERIC,
  created_at TIMESTAMPTZ
);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to events and markets
DROP TRIGGER IF EXISTS update_events_updated_at ON events;
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_markets_updated_at ON markets;
CREATE TRIGGER update_markets_updated_at BEFORE UPDATE ON markets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
