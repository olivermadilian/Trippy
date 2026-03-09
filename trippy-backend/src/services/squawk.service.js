const { customAlphabet } = require('nanoid');

// Same alphabet as brother's frontend: A-Z (no I, O) + 2-9 (no 0, 1)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generateCode = customAlphabet(ALPHABET, 6);

const SQUAWK_EXPIRY_HOURS = 24;

async function generateSquawkCode(supabase, tripId, userId) {
  // Try up to 3 times in case of code collision
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + SQUAWK_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('squawk_codes')
      .insert({
        code,
        trip_id: tripId,
        created_by: userId,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (!error) return data;

    // If unique constraint violation, retry with new code
    if (error.code === '23505') continue;
    throw error;
  }

  throw new Error('Failed to generate unique squawk code. Try again.');
}

async function claimSquawkCode(supabase, code, userId) {
  const normalizedCode = code.toUpperCase().replace(/\s+/g, '');

  if (normalizedCode.length !== 6) {
    throw new Error('Squawk code must be 6 characters.');
  }

  // Find unclaimed, unexpired code
  const { data: squawk, error: findError } = await supabase
    .from('squawk_codes')
    .select('*')
    .eq('code', normalizedCode)
    .is('claimed_by', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (findError || !squawk) {
    throw new Error('Invalid, expired, or already claimed squawk code.');
  }

  // Can't follow your own trip
  if (squawk.created_by === userId) {
    throw new Error('Cannot claim your own squawk code.');
  }

  // Claim the code
  const { error: claimError } = await supabase
    .from('squawk_codes')
    .update({
      claimed_by: userId,
      claimed_at: new Date().toISOString()
    })
    .eq('id', squawk.id);

  if (claimError) throw claimError;

  // Create follower relationship
  const { error: followError } = await supabase
    .from('trip_followers')
    .upsert(
      {
        trip_id: squawk.trip_id,
        follower_id: userId,
        squawk_code_id: squawk.id,
      },
      { onConflict: 'trip_id,follower_id' }
    );

  if (followError) throw followError;

  return { trip_id: squawk.trip_id, code: normalizedCode };
}

module.exports = { generateSquawkCode, claimSquawkCode };
