async function claimSquawkCode(supabase, code, userId) {
  const normalizedCode = code.trim();

  if (!/^\d{4}$/.test(normalizedCode)) {
    throw new Error('Squawk code must be exactly 4 digits.');
  }

  const today = new Date().toISOString().slice(0, 10);

  // Find an active trip with this squawk code
  const { data: trip, error: findError } = await supabase
    .from('trips')
    .select('id, user_id, squawk_code')
    .eq('squawk_code', normalizedCode)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .single();

  if (findError || !trip) {
    throw new Error('Invalid or inactive squawk code.');
  }

  // Can't follow your own trip
  if (trip.user_id === userId) {
    throw new Error('Cannot claim your own squawk code.');
  }

  // Create follower relationship
  const { error: followError } = await supabase
    .from('trip_followers')
    .upsert(
      {
        trip_id: trip.id,
        follower_id: userId,
      },
      { onConflict: 'trip_id,follower_id' }
    );

  if (followError) throw followError;

  return { trip_id: trip.id, code: normalizedCode };
}

module.exports = { claimSquawkCode };
