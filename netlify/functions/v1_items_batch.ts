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
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,If-None-Match',
    // Important: If-None-Match affects representation
    'Vary': 'Origin,If-None-Match'
  }
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl
  if (opts.etag) headers['ETag'] = opts.etag
  return { statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) }
}

function toInt(v: any, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function normalizeUuidList(input: any, max: number): string[] {
  const arr = Array.isArray(input) ? input : []
  const cleaned = arr
    .filter((x) => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  // Dedupe + sort to maximize cache hits and avoid duplicate work.
  // (If you ever need to preserve input order, remove `.sort()`.)
  const uniq = Array.from(new Set(cleaned)).sort()

  return uniq.slice(0, max)
}

function cmpString(a: any, b: any) {
  return (a ?? '').toString().localeCompare((b ?? '').toString())
}

function cmpNullableIsoDateDesc(a: any, b: any) {
  // Put newest first. Nulls last.
  const at = a ? Date.parse(a) : NaN
  const bt = b ? Date.parse(b) : NaN
  const aOk = Number.isFinite(at)
  const bOk = Number.isFinite(bt)
  if (!aOk && !bOk) return 0
  if (!aOk) return 1
  if (!bOk) return -1
  return bt - at
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, '')
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method Not Allowed' })

  const url = process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) return resp(500, { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' })

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // Tight TTL is fine here because items change frequently.
  // The important win is conditional GET via ETag (304).
  const cacheControl = 'public, max-age=30, s-maxage=120, stale-while-revalidate=900'

  let payload: any = {}
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return resp(400, { error: 'Invalid JSON body' })
  }

  try {
    const MAX_FEEDS = 20
    const MAX_PER_FEED = 30

    const trimmedFeedIds = normalizeUuidList(payload.feed_ids, MAX_FEEDS)
    if (trimmedFeedIds.length === 0) return resp(400, { error: 'feed_ids must be a non-empty array' })

    const requestedLimit = toInt(payload.limit_per_feed, 10)
    const limitPerFeed = Math.max(1, Math.min(requestedLimit, MAX_PER_FEED))

    const { data, error } = await supabase.rpc('rpc_items_batch_v1', {
      p_feed_ids: trimmedFeedIds,
      p_limit_per_feed: limitPerFeed
    })
    if (error) throw error

    const row = Array.isArray(data) ? data[0] : data

    const items = (row?.items ?? []).map((i: any) => ({
      item_id: i.item_id,
      title: i.title ?? 'Untitled',
      url: i.url ?? null,
      published_at: i.published_at ?? null,
      image_url: i.image_url ?? null,
      source: i.source ?? null
    }))

    // Stable ordering (defensive). Prefer: published_at desc, then item_id asc.
    items.sort((a: any, b: any) => {
      const d = cmpNullableIsoDateDesc(a.published_at, b.published_at)
      if (d !== 0) return d
      return cmpString(a.item_id, b.item_id)
    })

    const response = {
      api_version: '1.0',
      // Keep it, but do NOT invent a new one (that destroys determinism).
      generated_at: row?.generated_at ?? null,
      request: {
        feed_ids: trimmedFeedIds,
        limit_per_feed: limitPerFeed
      },
      items
    }

    // ETag excludes generated_at so it only changes when payload materially changes.
    const etagPayload = {
      api_version: response.api_version,
      request: response.request,
      items: response.items
    }

    const etag = `"${sha256(JSON.stringify(etagPayload))}"`
    const inm = event.headers['if-none-match'] || event.headers['If-None-Match']
    if (inm && inm === etag) return resp(304, '', { etag, cacheControl })

    return resp(200, response, { etag, cacheControl })
  } catch (err: any) {
    return resp(500, { error: err?.message ?? String(err) })
  }
}
