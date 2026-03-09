-- =============================================
-- Trippy Backend — Database Schema
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- =============================================

-- 1. PROFILES (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile when a user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. TRIPS
CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trips_user_id ON trips(user_id);
CREATE INDEX idx_trips_start_date ON trips(start_date);

-- 3. LEGS (segments within a trip)
CREATE TABLE legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN ('flight', 'hotel', 'train', 'bus')),
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'in_air', 'in_transit', 'completed', 'cancelled')),

  -- Origin / Destination
  origin_code TEXT,
  origin_city TEXT,
  origin_lat DECIMAL(9,6),
  origin_lng DECIMAL(9,6),
  destination_code TEXT,
  destination_city TEXT,
  destination_lat DECIMAL(9,6),
  destination_lng DECIMAL(9,6),

  -- Times (ISO timestamps)
  depart_time TIMESTAMPTZ,
  arrive_time TIMESTAMPTZ,
  actual_depart TIMESTAMPTZ,
  actual_arrive TIMESTAMPTZ,

  -- Carrier info
  carrier TEXT,
  vehicle_number TEXT,

  -- Type-specific metadata as JSONB
  -- Flight: { aircraft, class, terminal, gate, seat, confirmation }
  -- Hotel:  { room_type, nights, room, confirmation, address }
  -- Train:  { train_type, seat, car, platform, confirmation }
  -- Bus:    { seat, platform, confirmation }
  metadata JSONB DEFAULT '{}',

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_legs_trip_id ON legs(trip_id);
CREATE INDEX idx_legs_sort_order ON legs(trip_id, sort_order);
CREATE INDEX idx_legs_depart_time ON legs(depart_time);

-- 4. SQUAWK CODES (sharing)
CREATE TABLE squawk_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code CHAR(6) NOT NULL UNIQUE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  claimed_by UUID REFERENCES profiles(id),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_squawk_code ON squawk_codes(code);
CREATE INDEX idx_squawk_trip ON squawk_codes(trip_id);

-- 5. TRIP FOLLOWERS (result of claiming squawk codes)
CREATE TABLE trip_followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  squawk_code_id UUID REFERENCES squawk_codes(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trip_id, follower_id)
);

CREATE INDEX idx_followers_trip ON trip_followers(trip_id);
CREATE INDEX idx_followers_user ON trip_followers(follower_id);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE squawk_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_followers ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone can read, only owner can update
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Trips: owner full access, followers can read, public trips readable by all
CREATE POLICY "trips_owner_all" ON trips FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "trips_follower_select" ON trips FOR SELECT USING (
  EXISTS (SELECT 1 FROM trip_followers WHERE trip_id = trips.id AND follower_id = auth.uid())
);
CREATE POLICY "trips_public_select" ON trips FOR SELECT USING (is_public = true);

-- Legs: inherit trip access
CREATE POLICY "legs_owner_all" ON legs FOR ALL USING (
  EXISTS (SELECT 1 FROM trips WHERE trips.id = legs.trip_id AND trips.user_id = auth.uid())
);
CREATE POLICY "legs_follower_select" ON legs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM trip_followers tf
    JOIN trips t ON t.id = tf.trip_id
    WHERE t.id = legs.trip_id AND tf.follower_id = auth.uid()
  )
);

-- Squawk codes: creator full access, anyone can read unclaimed codes
CREATE POLICY "squawk_creator_all" ON squawk_codes FOR ALL USING (created_by = auth.uid());
CREATE POLICY "squawk_select_all" ON squawk_codes FOR SELECT USING (true);

-- Trip followers: trip owner can manage, followers can see their own
CREATE POLICY "followers_trip_owner" ON trip_followers FOR ALL USING (
  EXISTS (SELECT 1 FROM trips WHERE trips.id = trip_followers.trip_id AND trips.user_id = auth.uid())
);
CREATE POLICY "followers_self_select" ON trip_followers FOR SELECT USING (follower_id = auth.uid());
CREATE POLICY "followers_self_insert" ON trip_followers FOR INSERT WITH CHECK (follower_id = auth.uid());
