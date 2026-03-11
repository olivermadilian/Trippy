import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || "https://ggntsbxftvzlmhiclthu.supabase.co",
  import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_scjJQK43V9tbYq-ehRAASw_U_P7Z52j"
);
