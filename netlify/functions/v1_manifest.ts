import type { Handler } from '@netlify/functions'
import { createServiceClient } from '../../src/lib/supabase'
import { resp, errResp, sha256, supabaseErr } from '../../src/lib/response'

// Deterministic sort helpers
function cmpNullableNumber(a: any, b: any) {
  const an = typeof a === 'number' ? a : Number.isFinite(Number(a)) ? Number(a) : null
  const bn = typeof b === 'number' ? b : Number.isFinite(Number(b)) ? Number(b) : null
  if (an === null && bn === null) return 0
  if (an === null) return 1
  if (bn === null) return -1
  return an - bn
}
function cmpString(a: any, b: any) {
  return ((a ?? '').toString()).localeCompare((b ?? '').toString())
}
function toNullableInt(v: any) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
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

  // Previously had s-maxage=3600, stale-while-revalidate=86400. That made config
  // changes (topic colours, new feeds, toggles) linger on CDN nodes for up to
  // a day. ETag still gives us 304s for unchanged bodies, so shorter TTLs
  // don't cost much bandwidth but massively improve propagation.
  const cacheControl = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300'

  try {
    const { data, error } = await supabase.rpc('rpc_manifest_v1')
    if (error) return supabaseErr(error)

    const row = Array.isArray(data) ? data[0] : data

    const topics = (row?.topics ?? []).map((t: any) => ({
      topic_id: t.topic_id,
      slug: t.slug,
      label: t.label,
      sort_order: toNullableInt(t.sort_order),
      orb_color: t.orb_color ?? null,
      cadence_minutes: toNullableInt(t.cadence_minutes),
      uses_sentiment_color: !!t.uses_sentiment_color
    }))

    topics.sort((a: any, b: any) => {
      const so = cmpNullableNumber(a.sort_order, b.sort_order)
      if (so !== 0) return so
      const slug = cmpString(a.slug, b.slug)
      if (slug !== 0) return slug
      return cmpString(a.topic_id, b.topic_id)
    })

    const feed_index = (row?.feeds ?? []).map((f: any) => ({
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
            sort_order: toNullableInt(f.category.sort_order)
          }
        : null,
      default_enabled: true
    }))

    feed_index.sort((a: any, b: any) => {
      const so = cmpNullableNumber(a.category?.sort_order ?? null, b.category?.sort_order ?? null)
      if (so !== 0) return so
      const cslug = cmpString(a.category?.slug, b.category?.slug)
      if (cslug !== 0) return cslug
      const cname = cmpString(a.category?.name, b.category?.name)
      if (cname !== 0) return cname
      const title = cmpString(a.title, b.title)
      if (title !== 0) return title
      return cmpString(a.feed_id, b.feed_id)
    })

    const limits = {
      items_max_feeds: 20,
      items_max_items: 200,
      limit_per_feed_max: 30
    }

    const response = {
      api_version: '1.0',
      generated_at: row?.generated_at ?? null,
      cache_ttl_sec: 3600,
      limits,
      topics,
      feed_index
    }

    // ETag on stable payload only (excludes generated_at).
    const etagPayload = {
      api_version: response.api_version,
      cache_ttl_sec: response.cache_ttl_sec,
      limits: response.limits,
      topics: response.topics,
      feed_index: response.feed_index
    }

    const etag = `"${sha256(JSON.stringify(etagPayload))}"`
    const inm = event.headers['if-none-match'] || event.headers['If-None-Match']
    if (inm && inm === etag) return resp(304, '', { etag, cacheControl })

    return resp(200, response, { etag, cacheControl })
  } catch (err: any) {
    return supabaseErr(err)
  }
}
