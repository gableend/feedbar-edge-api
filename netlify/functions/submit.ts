import type { Handler } from '@netlify/functions'
import { createServiceClient } from '../../src/lib/supabase'
import { resp, errResp, supabaseErr } from '../../src/lib/response'
import { fetchFeed } from '../../src/rss'

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, '')
  if (event.httpMethod !== 'POST') {
    return errResp(405, 'METHOD_NOT_ALLOWED', 'Only POST is accepted')
  }

  let parsed: any
  try {
    parsed = JSON.parse(event.body || '{}')
  } catch {
    return errResp(400, 'BAD_JSON', 'Request body must be valid JSON')
  }

  const url = typeof parsed?.url === 'string' ? parsed.url.trim() : ''
  if (!url) return errResp(400, 'MISSING_URL', 'Field "url" is required')

  let supabase
  try {
    supabase = createServiceClient()
  } catch (err: any) {
    return errResp(500, 'SERVER_MISCONFIGURED', err?.message ?? 'Missing Supabase env')
  }

  // 1. Is the feed already registered?
  const { data: existing, error: lookupErr } = await supabase
    .from('feeds')
    .select('id, name')
    .eq('url', url)
    .maybeSingle()
  if (lookupErr) return supabaseErr(lookupErr)
  if (existing) {
    return resp(200, { feed_id: existing.id, title: existing.name, is_new: false })
  }

  // 2. Validate + fetch title by actually parsing the RSS.
  const fetched = await fetchFeed(url)
  if (!fetched) return errResp(422, 'INVALID_FEED', 'URL did not resolve to a parseable RSS feed')

  const title = (fetched.title && fetched.title.length > 0) ? fetched.title : 'New Discovery'

  // 3. Insert the new feed.
  const { data: newFeed, error: insertErr } = await supabase
    .from('feeds')
    .insert({ url, name: title, category: 'Custom' })
    .select('id, name')
    .single()
  if (insertErr) return supabaseErr(insertErr)

  return resp(200, { feed_id: newFeed.id, title: newFeed.name, is_new: true })
}
