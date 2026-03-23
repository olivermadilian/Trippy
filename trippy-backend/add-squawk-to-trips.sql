ALTER TABLE trips ADD COLUMN IF NOT EXISTS squawk_code VARCHAR(4);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_squawk_code ON trips(squawk_code) WHERE squawk_code IS NOT NULL;
