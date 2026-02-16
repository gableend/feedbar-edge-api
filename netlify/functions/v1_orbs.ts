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
    // include If-None-Match in Vary so intermediaries don’t do dumb things
    'Vary': 'Origin, If-None-Match'
  }
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl
  if (opts.etag) headers['ETag'] = opts.etag
  return { statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) }
}

// deterministic helpers
function cmpNullableNumber(a: any, b: any) {
  const an = typeof a === 'number' ? a : Number.isFinite(Number(a)) ? Number(a) : null
  const bn = typeof b === 'number' ? b : Number.isFinite(Number(b)) ? Number(b) : null
  if (an === null && bn === null) return 0
  if (an === null) return 1
  if (bn === null) return -1
  return an - bn
}
function cmpString(a: any, b: any) {
  const as = (a ?? '').toString()
  const bs = (b ?? '').toString()
  return as.localeCompare(bs)
}
function toNullableInt(v: any) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
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

    // Build + canonicalize orbs
    const orbs = (row?.orbs ?? []).map((o: any) => ({
      topic_id: o.topic_id,
      topic_slug: o.topic_slug,
      topic_label: o.topic_label,
      display_color: o.display_color ?? null,
      resting_color: o.resting_color ?? null,
      window_end: o.window_end ?? null,
      window_minutes: toNullableInt(o.window_minutes),
      keywords: Array.isArray(o.keywords) ? o.keywords : [],
      sentiment: o.sentiment ?? { label: null, score: null },
      summary: o.summary ?? null,
      velocity: o.velocity ?? { per_hour: null, ui: null },
      volume: toNullableInt(o.volume),
      diversity: toNullableInt(o.diversity),
      label_status: o.label_status ?? null,
      top_sources: o.top_sources ?? [],
      top_items: o.top_items ?? [],
      output_hash: o.output_hash ?? null,
      updated_at: o.updated_at ?? null
    }))

    // Deterministic ordering (don’t trust upstream JSON agg ordering forever)
    orbs.sort((a: any, b: any) => {
      // If you want topic sort order, include it in the RPC; for now use slug/label
      const slug = cmpString(a.topic_slug, b.topic_slug)
      if (slug !== 0) return slug
      const label = cmpString(a.topic_label, b.topic_label)
      if (label !== 0) return label
      return cmpString(a.topic_id, b.topic_id)
    })

    // Optional: deterministic ordering inside arrays (helps avoid accidental reshuffles)
    for (const o of orbs) {
      if (Array.isArray(o.keywords)) o.keywords = [...o.keywords].map(String).sort((x: string, y: string) => x.localeCompare(y))
      if (Array.isArray(o.top_sources)) {
        o.top_sources = [...o.top_sources].sort((x: any, y: any) => {
          const c = cmpNullableNumber(y?.count ?? null, x?.count ?? null) // desc count
          if (c !== 0) return c
          return cmpString(x?.feed_id, y?.feed_id)
        })
      }
      if (Array.isArray(o.top_items)) {
        o.top_items = [...o.top_items].sort((x: any, y: any) => {
          const s = cmpNullableNumber(y?.score ?? null, x?.score ?? null) // desc score
          if (s !== 0) return s
          return cmpString(x?.item_id, y?.item_id)
        })
      }
    }

    const response = {
      api_version: '1.0',
      generated_at: row?.generated_at ?? null, // DO NOT fallback to Date() or you reintroduce nondeterminism
      orbs
    }

    // ETag: stable payload only (exclude generated_at)
    // Strong opinion: also exclude updated_at if you don’t want a repaint when only timestamps drift.
    // If updated_at is legit “data changed”, keep it included.
    const etagPayload = {
      api_version: response.api_version,
      orbs: response.orbs
    }

    const etag = `"${sha256(JSON.stringify(etagPayload))}"`
    const inm = event.headers['if-none-match'] || event.headers['If-None-Match']
    if (inm && inm === etag) return resp(304, '', { etag, cacheControl })

    return resp(200, response, { etag, cacheControl })
  } catch (err: any) {
    return resp(500, { error: err?.message ?? String(err) })
  }
}
