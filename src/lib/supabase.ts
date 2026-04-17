import { createClient, SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for edge functions.
 * Prefers SUPABASE_SERVICE_ROLE_KEY; falls back to legacy SUPABASE_KEY.
 * Throws if neither is set so callers fail fast with a clear message.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}
