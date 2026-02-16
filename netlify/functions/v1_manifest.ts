import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function resp(
  statusCode: number,
  body: any,
  opts: { etag?: string; cacheControl?: string } = {}
) {
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
  const cacheControl = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'

  try {
    const { data, error } = await supabase.rpc('rpc_manifest_v1')
    if (error) throw error

    const row = Array.isArray(data) ? data[0] : data
    const response = {
      api_version: '1.0',
      generated_at: row?.generated_at ?? new Date().toISOString(),
      cache_ttl_sec: 3600,
      limits: {
        items_max_feeds: 20,
        items_max_items: 200,
        limit_per_feed_max: 30
      },
      topics: (row?.topics ?? []).map((t: any) => ({
        topic_id: t.topic_id,
        slug: t.slug,
        label: t.label,
        sort_order: t.sort_order ?? null,
        orb_color: t.orb_color ?? null,
        cadence_minutes: t.cadence_minutes ?? null,
        uses_sentiment_color: t.uses_sentiment_color ?? false
      })),
      feed_index: (row?.feeds ?? []).map((f: any) => ({
        feed_id: f.feed_id,
        title: f.title,
        url: f.url,
        icon_url: f.icon_url ?? null,
        is_active: f.is_active ?? true,
        category: f.category
          ? {
              category_id: f.category.category_id ?? null,
              name: f.category.name ?? null,
              slug: f.category.slug ?? null,
              sort_order: f.category.sort_order ?? null
            }
          : null,
        default_enabled: true
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
