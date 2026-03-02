/**
 * Shared Supabase configuration helpers.
 * Used across all admin API routes to avoid copy-paste.
 */

export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key, configured: !!(url && key) };
}

export function supabaseHeaders(key: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}
