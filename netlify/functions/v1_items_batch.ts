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
    'Vary': 'Origin,If-None-Match'
  }
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl
  if (opts.etag) headers['ETag'] = opts.etag
  return { statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) }
}

function isUuidLike(s: string) {
  // Good enough for request hygiene (not full validation)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function parseIntSafe(v: any, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function cmpString(a: any, b: any) {
  return (a ?? '').toString().localeCompare((b ?? '').toString())
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, '')
  if (event.httpMethod !== 'GET') return resp(405, { error: 'Method Not Allowed' })

  const url = process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) return resp(500, { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' })

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // Slightly longer than POST version because GET is now cache-friendly
  const cacheControl = 'public, max-age=30, s-maxage=120, stale-while-revalidate=900'

  // ---- Parse + canonicalize request (stable ordering is key for caching) ----
  const qs = new URLSearchParams(event.rawQuery || '')

  // feed_ids can be repeated and/or comma-separated
  const rawFeedIds: string[] = []
  for (const v of qs.getAll('feed_ids')) rawFeedIds.push(v)
  // Also accept feed_id(s) as an alias if you ever used it elsewhere
  for (const v of qs.getAll('feed_id')) rawFeedIds.push(v)

  const exploded = rawFeedIds
    .flatMap((x) => (x ?? '').split(','))
    .map((x) => x.trim())
    .filter(Boolean)
    .filter(isUuidLike)

  const MAX_FEEDS = 20
  const MAX_PER_FEED = 30

  // Dedup + sort for canonical request
  const canonicalFeedIds = Array.from(new Set(exploded)).sort(cmpString).slice(0, MAX_FEEDS)

  if (canonicalFeedIds.length === 0) {
    return resp(400, { error: 'feed_ids must be a non-empty array (uuid), via ?feed_ids=a,b,c or repeated feed_ids=...' })
  }

  const requestedLimit = parseIntSafe(qs.get('limit_per_feed'), 10)
  const limitPerFeed = Math.max(1, Math.min(requestedLimit, MAX_PER_FEED))

  try {
    const { data, error } = await supabase.rpc('rpc_items_batch_v1', {
      p_feed_ids: canonicalFeedIds,
      p_limit_per_feed: limitPerFeed
    })
    if (error) throw error

    const row = Array.isArray(data) ? data[0] : data

    // Canonicalize items too (just in case DB ordering changes later)
    const items = (row?.items ?? [])
      .map((i: any) => ({
        item_id: i.item_id,
        title: i.title ?? 'Untitled',
        url: i.url ?? null,
        published_at: i.published_at ?? null,
        image_url: i.image_url ?? null,
        source: i.source ?? null
      }))
      .sort((a: any, b: any) => {
        // newest first if published_at exists, then stable tie-breakers
        const ap = a.published_at ? Date.parse(a.published_at) : 0
        const bp = b.published_at ? Date.parse(b.published_at) : 0
        if (ap !== bp) return bp - ap
        const t = cmpString(a.title, b.title)
        if (t !== 0) return t
        return cmpString(a.item_id, b.item_id)
      })

    const response = {
      api_version: '1.0',
      // Do NOT include generated_at: it creates body noise and ruins caching value.
      request: {
        feed_ids: canonicalFeedIds,
        limit_per_feed: limitPerFeed
      },
      items
    }

    // ETag based on stable response (which is now deterministic)
    const body = JSON.stringify(response)
    const etag = `"${sha256(body)}"`

    const inm = event.headers['if-none-match'] || event.headers['If-None-Match']
    if (inm && inm === etag) return resp(304, '', { etag, cacheControl })

    return resp(200, body, { etag, cacheControl })
  } catch (err: any) {
    return resp(500, { error: err?.message ?? String(err) })
  }
}
