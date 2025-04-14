CREATE TABLE IF NOT EXISTS geo_measurements (
    id SERIAL PRIMARY KEY,
    subnet TEXT NOT NULL,
    day DATE NOT NULL,
    total BIGINT NOT NULL DEFAULT 1,
    successful BIGINT NOT NULL DEFAULT 0,
    
    -- Geo-specific fields
    continent TEXT,
    country TEXT,
    city TEXT,
    
    -- Performance data
    latency BIGINT,
    ttfb BIGINT,
    throughput BIGINT,
    
    -- Provider info
    miner_id TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS geo_measurements_day ON geo_measurements (day);
CREATE INDEX IF NOT EXISTS geo_measurements_continent ON geo_measurements (continent);
CREATE INDEX IF NOT EXISTS geo_measurements_miner ON geo_measurements (miner_id);