export function normalizeInstagramUrl(url: string): string {
  try {
    const parsed = new URL(url.trim())
    let path = parsed.pathname.toLowerCase()
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1)
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    return `${host}${path}`
  } catch {
    return url.trim().toLowerCase().split('?')[0].replace(/\/+$/, '')
  }
}
