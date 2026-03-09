const { createUserClient } = require('../config/supabase');
const { generateSquawkCode, claimSquawkCode } = require('../services/squawk.service');

async function generate(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { trip_id } = req.body;

  if (!trip_id) {
    return res.status(400).json({ error: 'trip_id is required' });
  }

  try {
    const squawk = await generateSquawkCode(supabase, trip_id, req.user.id);
    res.status(201).json(squawk);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

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

  const { data, error } = await supabase
    .from('squawk_codes')
    .select('*, claimed_by_profile:claimed_by(display_name)')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Format response
  const codes = (data || []).map(s => ({
    id: s.id,
    code: s.code,
    created_at: s.created_at,
    expires_at: s.expires_at,
    claimed_by: s.claimed_by_profile?.display_name || null,
    claimed_at: s.claimed_at,
    is_active: !s.claimed_by && new Date(s.expires_at) > new Date()
  }));

  res.json(codes);
}

async function revoke(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { codeId } = req.params;

  const { error } = await supabase
    .from('squawk_codes')
    .delete()
    .eq('id', codeId)
    .eq('created_by', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
}

module.exports = { generate, claim, listForTrip, revoke };
