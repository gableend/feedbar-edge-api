import type { Handler } from '@netlify/functions'
import { createServiceClient } from '../../src/lib/supabase'
import { resp, errResp, sha256, supabaseErr } from '../../src/lib/response'

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

  const cacheControl = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600'

  try {
    const { data, error } = await supabase.rpc('rpc_orbs_v1')
    if (error) return supabaseErr(error)

    const row = Array.isArray(data) ? data[0] : data

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

    orbs.sort((a: any, b: any) => {
      const slug = cmpString(a.topic_slug, b.topic_slug)
      if (slug !== 0) return slug
      const label = cmpString(a.topic_label, b.topic_label)
      if (label !== 0) return label
      return cmpString(a.topic_id, b.topic_id)
    })

    for (const o of orbs) {
      if (Array.isArray(o.keywords)) {
        o.keywords = [...o.keywords].map(String).sort((x: string, y: string) => x.localeCompare(y))
      }
      if (Array.isArray(o.top_sources)) {
        o.top_sources = [...o.top_sources].sort((x: any, y: any) => {
          const c = cmpNullableNumber(y?.count ?? null, x?.count ?? null)
          if (c !== 0) return c
          return cmpString(x?.feed_id, y?.feed_id)
        })
      }
      if (Array.isArray(o.top_items)) {
        o.top_items = [...o.top_items].sort((x: any, y: any) => {
          const s = cmpNullableNumber(y?.score ?? null, x?.score ?? null)
          if (s !== 0) return s
          return cmpString(x?.item_id, y?.item_id)
        })
      }
    }

    const response = {
      api_version: '1.0',
      generated_at: row?.generated_at ?? null,
      orbs
    }

    const etagPayload = { api_version: response.api_version, orbs: response.orbs }
    const etag = `"${sha256(JSON.stringify(etagPayload))}"`
    const inm = event.headers['if-none-match'] || event.headers['If-None-Match']
    if (inm && inm === etag) return resp(304, '', { etag, cacheControl })

    return resp(200, response, { etag, cacheControl })
  } catch (err: any) {
    return supabaseErr(err)
  }
}
