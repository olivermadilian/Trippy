const { createUserClient } = require('../config/supabase');

async function getMe(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Profile not found' });
  res.json(data);
}

async function updateMe(req, res) {
  const supabase = createUserClient(req.accessToken);
  const { display_name, avatar_url } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (display_name !== undefined) updates.display_name = display_name;
  if (avatar_url !== undefined) updates.avatar_url = avatar_url;

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

module.exports = { getMe, updateMe };
