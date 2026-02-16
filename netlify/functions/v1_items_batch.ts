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
    'Vary': 'Origin'
  }
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl
  if (opts.etag) headers['ETag'] = opts.etag
  return { statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, '')
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method Not Allowed' })

  const url = process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) return resp(500, { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' })

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const cacheControl = 'public, max-age=30, s-maxage=120, stale-while-revalidate=900'

  try {
    const payload = JSON.parse(event.body || '{}')
    const feedIds: string[] = Array.isArray(payload.feed_ids) ? payload.feed_ids : []
    const requestedLimit = Number(payload.limit_per_feed ?? 10)

    const MAX_FEEDS = 20
    const MAX_PER_FEED = 30

    const limitPerFeed = Math.max(1, Math.min(requestedLimit, MAX_PER_FEED))
    const trimmedFeedIds = feedIds
      .slice(0, MAX_FEEDS)
      .filter((x) => typeof x === 'string' && x.length > 0)

    if (trimmedFeedIds.length === 0) return resp(400, { error: 'feed_ids must be a non-empty array' })

    const { data, error } = await supabase.rpc('rpc_items_batch_v1', {
      p_feed_ids: trimmedFeedIds,
      p_limit_per_feed: limitPerFeed
    })
    if (error) throw error

    const row = Array.isArray(data) ? data[0] : data
    const response = {
      api_version: '1.0',
      generated_at: row?.generated_at ?? new Date().toISOString(),
      request: {
        feed_ids: trimmedFeedIds,
        limit_per_feed: limitPerFeed
      },
      items: (row?.items ?? []).map((i: any) => ({
        item_id: i.item_id,
        title: i.title ?? 'Untitled',
        url: i.url ?? null,
        published_at: i.published_at ?? null,
        image_url: i.image_url ?? null,
        source: i.source ?? null
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
