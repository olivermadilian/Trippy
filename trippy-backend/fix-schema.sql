-- =============================================
-- Trippy — Database Fix Script
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- Fixes: "Database error saving new user" + infinite recursion
-- =============================================

-- ─── FIX 1: Add missing INSERT policy on profiles ───
-- The handle_new_user trigger needs to INSERT into profiles
-- but there was no INSERT policy, so RLS blocked it.
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (true);

-- ─── FIX 2: Recreate trigger function with explicit RLS bypass ───
-- Force the function to run as postgres superuser and bypass RLS
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log but don't crash signup if profile creation fails
  RAISE WARNING 'handle_new_user failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── FIX 3: Break infinite recursion in trips/trip_followers RLS ───
-- Problem: trips policy checks trip_followers, trip_followers policy checks trips → loop
-- Solution: use SECURITY DEFINER helper functions that bypass RLS

-- Drop the recursive policies
DROP POLICY IF EXISTS "trips_follower_select" ON trips;
DROP POLICY IF EXISTS "followers_trip_owner" ON trip_followers;

-- Helper function: check if user follows a trip (bypasses RLS)
CREATE OR REPLACE FUNCTION is_trip_follower(trip_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_followers
    WHERE trip_id = trip_uuid AND follower_id = user_uuid
  );
$$ LANGUAGE sql;

-- Helper function: check if user owns a trip (bypasses RLS)
CREATE OR REPLACE FUNCTION is_trip_owner(trip_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trips
    WHERE id = trip_uuid AND user_id = user_uuid
  );
$$ LANGUAGE sql;

-- Recreate policies using helper functions (no more recursion)
CREATE POLICY "trips_follower_select" ON trips
  FOR SELECT USING (is_trip_follower(id, auth.uid()));

CREATE POLICY "followers_trip_owner" ON trip_followers
  FOR ALL USING (is_trip_owner(trip_id, auth.uid()));

-- ─── DONE ───
-- Now try signing in again — it should work!
