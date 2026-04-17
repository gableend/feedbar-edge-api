/**
 * Reject URLs pointing at loopback / link-local / RFC1918 / cloud-metadata.
 * Cheap SSRF guard for URLs ultimately sourced from user input.
 */
export function isPublicHttpUrl(raw: string): boolean {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "metadata.google.internal") return false;
  if (host === "metadata" || host === "metadata.internal") return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 0) return false;
    if (a === 169 && b === 254) return false;           // AWS/GCP/Azure metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  }
  if (host.startsWith("[")) {
    const inner = host.slice(1, -1);
    if (inner === "::1") return false;
    if (inner.startsWith("fc") || inner.startsWith("fd")) return false;
    if (inner.startsWith("fe8") || inner.startsWith("fe9") || inner.startsWith("fea") || inner.startsWith("feb")) return false;
  }
  return true;
}
