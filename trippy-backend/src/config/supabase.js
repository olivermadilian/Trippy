const { createClient } = require('@supabase/supabase-js');

// Admin client — uses service role key, bypasses RLS
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Create a user-scoped client that respects RLS
function createUserClient(accessToken) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    }
  );
}

module.exports = { supabaseAdmin, createUserClient };
