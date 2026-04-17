import type { Handler } from '@netlify/functions'
import { resp, errResp } from '../../src/lib/response'

/**
 * Accept in-app feedback (star rating + comment + optional contact email)
 * and stash it as a tagged Buttondown subscriber record. This reuses the
 * same service the website's waitlist uses. Every submission creates a
 * unique "anonymous+<stamp>@feeds.bar" subscriber with the feedback in
 * its `notes` field, so duplicates never clash.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, '')
  if (event.httpMethod !== 'POST') return errResp(405, 'METHOD_NOT_ALLOWED', 'Only POST is accepted')

  const apiKey = process.env.BUTTONDOWN_API_KEY
  if (!apiKey) return errResp(500, 'SERVER_MISCONFIGURED', 'Missing BUTTONDOWN_API_KEY')

  let body: any = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return errResp(400, 'BAD_JSON', 'Request body must be valid JSON')
  }

  const rating = Number.isFinite(Number(body.rating))
    ? Math.max(0, Math.min(5, Math.trunc(Number(body.rating))))
    : 0
  const comment    = String(body.comment    ?? '').trim().slice(0, 4000)
  const email      = String(body.email      ?? '').trim().slice(0, 320)
  const appVersion = String(body.app_version ?? '').slice(0, 40)
  const macos      = String(body.macos      ?? '').slice(0, 80)

  if (rating === 0 && !comment) {
    return errResp(400, 'EMPTY', 'Provide a rating or a comment')
  }

  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating)
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const subscriberEmail = `anonymous+${stamp}@feeds.bar`

  const notes = [
    `Rating: ${rating}/5  ${stars}`,
    comment ? '' : null,
    comment,
    '---',
    email      ? `From: ${email}`        : 'Anonymous',
    appVersion ? `App:   ${appVersion}`  : null,
    macos      ? `macOS: ${macos}`       : null,
    `At:    ${new Date().toISOString()}`
  ].filter((l) => l !== null).join('\n')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch('https://api.buttondown.email/v1/subscribers', {
      method: 'POST',
      signal: ctrl.signal,
      redirect: 'manual', // don't follow redirects with our auth header attached
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email_address: subscriberEmail,
        tags: ['feedsbar-feedback'],
        notes
      })
    })

    if (!r.ok) {
      console.error('[feedback] Buttondown POST failed', r.status)
      return errResp(502, 'UPSTREAM_FAILED', 'Could not deliver feedback')
    }

    return resp(200, { ok: true })
  } catch (err: any) {
    const aborted = err?.name === 'AbortError'
    console.error('[feedback] submission failed', aborted ? 'timeout' : err?.name || 'error')
    return errResp(aborted ? 504 : 500, aborted ? 'UPSTREAM_TIMEOUT' : 'SERVER_ERROR',
                   aborted ? 'Upstream took too long' : 'Internal error')
  } finally {
    clearTimeout(timer)
  }
}
