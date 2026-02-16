import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function resp(statusCode: number, body: any, opts: { etag?: string; cacheControl?: string } = {}) {
  const origin = process.env.CORS_ALLOW_ORIGIN ?? '*'
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,If-None-Match',
    'Vary': 'Origin'
  }
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl
  if (opts.etag) headers['ETag'] = opts.etag
  return { statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, '')
  if (event.httpMethod !== 'GET') return resp(405, { error: 'Method Not Allowed' })

  const url = process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) return resp(500, { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' })

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const cacheControl = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600'

  try {
    const { data, error } = await supabase.rpc('rpc_orbs_v1')
    if (error) throw error

    const row = Array.isArray(data) ? data[0] : data
    const response = {
      api_version: '1.0',
      generated_at: row?.generated_at ?? new Date().toISOString(),
      orbs: (row?.orbs ?? []).map((o: any) => ({
        topic_id: o.topic_id,
        topic_slug: o.topic_slug,
        topic_label: o.topic_label,
        display_color: o.display_color ?? null,
        resting_color: o.resting_color ?? null,
        window_end: o.window_end ?? null,
        window_minutes: o.window_minutes ?? null,
        keywords: o.keywords ?? [],
        sentiment: o.sentiment ?? { label: null, score: null },
        summary: o.summary ?? null,
        velocity: o.velocity ?? { per_hour: null, ui: null },
        volume: o.volume ?? null,
        diversity: o.diversity ?? null,
        label_status: o.label_status ?? null,
        top_sources: o.top_sources ?? null,
        top_items: o.top_items ?? null,
        output_hash: o.output_hash ?? null,
        updated_at: o.updated_at ?? null
      }))
    }

    const body = JSON.stringify(response)
    const etag = `"${sha256(body)}"`
    const inm = event.headers['if-none-match'] || event.headers['If-None-Match']
    if (inm && inm === etag) return resp(304, '', { etag, cacheControl })

    return resp(200, body, { etag, cacheControl })
  } catch (err: any) {
    return resp(500, { error: err?.message ?? String(err) })
  }
}
