import crypto from 'crypto'

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export interface RespOpts {
  etag?: string
  cacheControl?: string
}

const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,If-None-Match',
  // Intentionally NOT varying on If-None-Match — it fragments CDN caches.
  'Vary': 'Origin'
}

export function resp(statusCode: number, body: any, opts: RespOpts = {}) {
  const origin = process.env.CORS_ALLOW_ORIGIN ?? '*'
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    'Access-Control-Allow-Origin': origin
  }
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl
  if (opts.etag) headers['ETag'] = opts.etag
  return {
    statusCode,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body)
  }
}

/** Structured error body: { error: { code, message, ...extra } }. */
export function errResp(
  statusCode: number,
  code: string,
  message: string,
  extra?: Record<string, any>
) {
  return resp(statusCode, { error: { code, message, ...(extra ?? {}) } })
}

/**
 * Surface a Supabase/PostgREST error as a 500 with a terser client payload,
 * and log full detail server-side for debugging.
 */
export function supabaseErr(err: any) {
  console.error('[edge-api] Supabase error:', {
    message: err?.message,
    code: err?.code,
    details: err?.details,
    hint: err?.hint
  })
  return errResp(500, 'SERVER_ERROR', err?.message ?? 'Internal error', {
    supabase_code: err?.code ?? null
  })
}
