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

// Шорткод Reels/поста: instagram.com/reel/<code>, /reels/<code>, /p/<code>, /<user>/reel/<code>
export function getInstagramShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[^/?#]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i)
  return m ? m[1] : null
}

// Та же публикация? Сравниваем по шорткоду (он регистрозависимый), а если его не удалось
// достать — по нормализованному адресу. /reel/ и /reels/ одного ролика считаются одинаковыми.
export function isSameReel(a: string, b: string): boolean {
  const codeA = getInstagramShortcode(a)
  const codeB = getInstagramShortcode(b)
  if (codeA && codeB) return codeA === codeB
  return normalizeInstagramUrl(a) === normalizeInstagramUrl(b)
}
