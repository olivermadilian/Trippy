const { createUserClient } = require('../config/supabase');
const { claimSquawkCode } = require('../services/squawk.service');

async function claim(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'code is required' });
  }

  try {
    const result = await claimSquawkCode(supabase, code, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function listForTrip(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { tripId } = req.params;

  // Get the trip's squawk code
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('squawk_code')
    .eq('id', tripId)
    .single();

  if (tripError) return res.status(500).json({ error: tripError.message });

  // Get followers for this trip
  const { data: followers, error: followError } = await supabase
    .from('trip_followers')
    .select('id, follower_id, created_at, profiles:follower_id(display_name)')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });

  if (followError) return res.status(500).json({ error: followError.message });

  const formattedFollowers = (followers || []).map(f => ({
    id: f.id,
    follower_id: f.follower_id,
    display_name: f.profiles?.display_name || null,
    created_at: f.created_at,
  }));

  res.json({
    squawk_code: trip?.squawk_code || null,
    followers: formattedFollowers,
  });
}

async function revoke(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { codeId } = req.params;

  // codeId here is the trip_followers record id — remove the follower
  const { error } = await supabase
    .from('trip_followers')
    .delete()
    .eq('id', codeId);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
}

module.exports = { claim, listForTrip, revoke };
