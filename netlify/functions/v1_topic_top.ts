import type { Handler } from '@netlify/functions'
import { createServiceClient } from '../../src/lib/supabase'
import { resp, errResp, sha256, supabaseErr } from '../../src/lib/response'

function toInt(v: any, fallback: number) {
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

  try {
    const rawSlug = (event.queryStringParameters?.topic_slug ?? '').toString()
    const topicSlug = rawSlug.trim().toLowerCase()
    if (!topicSlug) return errResp(400, 'MISSING_TOPIC_SLUG', 'Query parameter "topic_slug" is required')

    const limitRaw = toInt(event.queryStringParameters?.limit, 50)
    const limit = Math.max(1, Math.min(limitRaw, 100))

    const { data, error } = await supabase.rpc('rpc_topic_top_v1', {
      p_topic_slug: topicSlug,
      p_limit: limit
    })
    if (error) return supabaseErr(error)

    const row = Array.isArray(data) ? data[0] : data
    const topic = row?.topic ?? { topic_slug: topicSlug, label: null }
    const items = Array.isArray(row?.items) ? row.items : []

    const response = {
      api_version: '1.0',
      topic,
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
