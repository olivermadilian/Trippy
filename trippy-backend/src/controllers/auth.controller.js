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

  if (display_name !== undefined && (typeof display_name !== 'string' || display_name.length > 100)) {
    return res.status(400).json({ error: 'display_name must be a string of at most 100 characters' });
  }
  if (avatar_url !== undefined) {
    try {
      const parsed = new URL(avatar_url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return res.status(400).json({ error: 'avatar_url must be an http or https URL' });
      }
    } catch {
      return res.status(400).json({ error: 'avatar_url must be a valid URL' });
    }
  }

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
