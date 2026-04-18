import type { Handler } from '@netlify/functions'
import { createServiceClient } from '../../src/lib/supabase'
import { resp, errResp, sha256, supabaseErr } from '../../src/lib/response'
import { cmpString } from '../../src/lib/sort'

const MAX_FEEDS = 20
const MAX_PER_FEED = 30
const DEFAULT_PER_FEED = 10

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function parseIntSafe(v: any, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, '')
  if (event.httpMethod !== 'GET') return errResp(405, 'METHOD_NOT_ALLOWED', 'Only GET is accepted')

  let supabase
  try {
    supabase = createServiceClient()
  } catch (err: any) {
    return errResp(500, 'SERVER_MISCONFIGURED', err?.message ?? 'Missing Supabase env')
  }

  const cacheControl = 'public, max-age=30, s-maxage=120, stale-while-revalidate=900'

  // ---- Parse + validate ----
  const qs = new URLSearchParams(event.rawQuery || '')

  const rawFeedIds: string[] = []
  for (const v of qs.getAll('feed_ids')) rawFeedIds.push(v)
  for (const v of qs.getAll('feed_id')) rawFeedIds.push(v) // legacy alias

  const exploded = rawFeedIds
    .flatMap((x) => (x ?? '').split(','))
    .map((x) => x.trim())
    .filter(Boolean)

  const invalid = exploded.filter((x) => !isUuidLike(x))
  if (invalid.length > 0) {
    return errResp(400, 'INVALID_FEED_ID', 'One or more feed_ids are not UUIDs', {
      count: invalid.length,
      sample: invalid.slice(0, 3)
    })
  }

  const unique = Array.from(new Set(exploded))
  if (unique.length === 0) {
    return errResp(400, 'MISSING_FEED_IDS', 'Query parameter "feed_ids" is required (comma-separated UUIDs)')
  }
  if (unique.length > MAX_FEEDS) {
    return errResp(400, 'TOO_MANY_FEEDS', `At most ${MAX_FEEDS} feed_ids are allowed per request`, {
      received: unique.length,
      max: MAX_FEEDS
    })
  }
  const canonicalFeedIds = unique.sort(cmpString)

  const requestedLimit = parseIntSafe(qs.get('limit_per_feed'), DEFAULT_PER_FEED)
  const limitPerFeed = Math.max(1, Math.min(requestedLimit, MAX_PER_FEED))

  // Optional recency window. Used by dynamic bundles like "Pulse" to only
  // return items published in the last N minutes. Omitted → server default
  // (30 days). Clamped to [1, 7*24*60] so bad input can't hog the planner.
  const rawSince = qs.get('since_minutes')
  let sinceMinutes: number | null = null
  if (rawSince != null && rawSince !== '') {
    const n = parseIntSafe(rawSince, 0)
    if (n > 0) sinceMinutes = Math.min(n, 7 * 24 * 60)
  }

  try {
    const rpcArgs: Record<string, unknown> = {
      p_feed_ids: canonicalFeedIds,
      p_limit_per_feed: limitPerFeed
    }
    if (sinceMinutes != null) rpcArgs.p_since_minutes = sinceMinutes

    const { data, error } = await supabase.rpc('rpc_items_batch_v1', rpcArgs)
    if (error) return supabaseErr(error)

    const row = Array.isArray(data) ? data[0] : data

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
        const ap = a.published_at ? Date.parse(a.published_at) : 0
        const bp = b.published_at ? Date.parse(b.published_at) : 0
        if (ap !== bp) return bp - ap
        const t = cmpString(a.title, b.title)
        if (t !== 0) return t
        return cmpString(a.item_id, b.item_id)
      })

    const response = {
      api_version: '1.0',
      request: {
        feed_ids: canonicalFeedIds,
        limit_per_feed: limitPerFeed,
        ...(sinceMinutes != null ? { since_minutes: sinceMinutes } : {})
      },
      items
    }

    const body = JSON.stringify(response)
    const etag = `"${sha256(body)}"`
    const inm = event.headers['if-none-match'] || event.headers['If-None-Match']
    if (inm && inm === etag) return resp(304, '', { etag, cacheControl })

    return resp(200, body, { etag, cacheControl })
  } catch (err: any) {
    return supabaseErr(err)
  }
}
