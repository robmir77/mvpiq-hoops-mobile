import { createClient } from "@supabase/supabase-js"

export const supabase = createClient(
    "https://PROJECT.supabase.co",
    "PUBLIC_ANON_KEY"
)