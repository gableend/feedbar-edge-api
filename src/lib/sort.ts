// Deterministic sort / coercion helpers used by every v1_* endpoint to
// keep ETag hashes stable across runs.

export function cmpNullableNumber(a: any, b: any): number {
  const an = typeof a === 'number' ? a : Number.isFinite(Number(a)) ? Number(a) : null
  const bn = typeof b === 'number' ? b : Number.isFinite(Number(b)) ? Number(b) : null
  if (an === null && bn === null) return 0
  if (an === null) return 1
  if (bn === null) return -1
  return an - bn
}

export function cmpString(a: any, b: any): number {
  return ((a ?? '').toString()).localeCompare((b ?? '').toString())
}

export function toNullableInt(v: any): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
