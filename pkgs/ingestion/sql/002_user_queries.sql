-- 002_user_queries.sql
-- Tables and views for user query logging and self-improvement proposals.

-- ---------------------------------------------------------------------------
-- Table: user_queries — logs every chat interaction
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_queries (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id      TEXT NOT NULL,
    user_message    TEXT NOT NULL,
    assistant_response TEXT NOT NULL DEFAULT '',
    tools_used      JSONB NOT NULL DEFAULT '[]',
    tool_count      INTEGER NOT NULL DEFAULT 0,
    latency_ms      INTEGER NOT NULL DEFAULT 0,
    error           BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_queries_session ON user_queries (session_id);
CREATE INDEX IF NOT EXISTS idx_user_queries_created ON user_queries (created_at DESC);

-- ---------------------------------------------------------------------------
-- Table: improvement_proposals — AI-generated upgrade suggestions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS improvement_proposals (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    difficulty      TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    category        TEXT NOT NULL CHECK (category IN ('tool', 'prompt', 'ux', 'data', 'performance')),
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    evidence        TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected', 'implemented')),
    query_count     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_improvement_proposals_status ON improvement_proposals (status);

-- ---------------------------------------------------------------------------
-- View: v_query_analytics — flattened query data for Lightdash
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_query_analytics AS
SELECT
    id,
    session_id,
    user_message,
    assistant_response,
    tools_used,
    tool_count,
    latency_ms,
    error,
    created_at,
    -- Derived columns
    array_to_string(ARRAY(SELECT jsonb_array_elements_text(tools_used)), ', ') AS tools_used_list,
    EXTRACT(HOUR FROM created_at) AS query_hour,
    DATE(created_at) AS query_date,
    CASE
        WHEN LENGTH(user_message) < 50 THEN 'short'
        WHEN LENGTH(user_message) < 200 THEN 'medium'
        ELSE 'long'
    END AS message_length_bucket,
    error AS had_error
FROM user_queries;

-- ---------------------------------------------------------------------------
-- View: v_query_tool_usage — tool usage aggregated per day
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_query_tool_usage AS
SELECT
    tool_name,
    COUNT(*) AS usage_count,
    DATE(q.created_at) AS usage_date
FROM user_queries q,
     jsonb_array_elements_text(q.tools_used) AS tool_name
GROUP BY tool_name, DATE(q.created_at);

-- ---------------------------------------------------------------------------
-- View: v_improvement_proposals — pass-through for Lightdash
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_improvement_proposals AS
SELECT
    id,
    difficulty,
    category,
    title,
    description,
    evidence,
    status,
    query_count,
    created_at
FROM improvement_proposals;
