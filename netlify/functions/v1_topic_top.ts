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
  const cacheControl = 'public, max-age=30, s-maxage=120, stale-while-revalidate=900'

  try {
    const topicSlug = (event.queryStringParameters?.topic_slug || '').trim()
    const limitRaw = Number(event.queryStringParameters?.limit ?? 50)
    const limit = Math.max(1, Math.min(limitRaw, 100))
    if (!topicSlug) return resp(400, { error: 'Missing topic_slug' })

    const { data, error } = await supabase.rpc('rpc_topic_top_v1', {
      p_topic_slug: topicSlug,
      p_limit: limit
    })
    if (error) throw error

    const row = Array.isArray(data) ? data[0] : data
    const response = {
      api_version: '1.0',
      generated_at: row?.generated_at ?? new Date().toISOString(),
      topic: row?.topic ?? { topic_slug: topicSlug, label: null },
      items: row?.items ?? []
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
