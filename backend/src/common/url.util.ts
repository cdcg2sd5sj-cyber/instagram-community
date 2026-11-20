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

// Ссылка скопирована через «Поделиться → Копировать ссылку» в самом Instagram?
// Instagram добавляет к такой ссылке служебную метку:
// - сейчас: параметр со случайным именем из букв, значение — base64 от кода из 8–24
//   строчных букв и цифр (например ?fqnt=Zjloc2FpZnl0dGhh → "f9hsaifyttha");
// - раньше: ?igsh=... или ?igshid=...
// Ссылка из адресной строки или из нашего же задания такой метки не имеет.
export function hasInstagramShareToken(url: string): boolean {
  let params: URLSearchParams
  try {
    params = new URL(url.trim()).searchParams
  } catch {
    return false
  }
  for (const [key, value] of params) {
    if ((key === 'igsh' || key === 'igshid') && value.length >= 6) return true
    if (!/^[a-z]{3,8}$/.test(key) || !/^[A-Za-z0-9+/]{8,40}={0,2}$/.test(value)) continue
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    if (/^[a-z0-9]{8,24}$/.test(decoded)) return true
  }
  return false
}
