import axios, { AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios'
import { PrismaService } from '../prisma/prisma.service'

// Ссылки на фото профиля с CDN Instagram подписаны и живут ограниченное время,
// потом CDN отвечает 403. Поэтому мы один раз скачиваем саму картинку и храним
// её у себя в БД (User.avatarImage), а отдаём через GET /users/:id/avatar.
//
// Запросы к RapidAPI на бесплатном тарифе ограничены (20 в месяц), и они нужны
// в первую очередь для регистрации. Поэтому для аватарок:
// - при регистрации картинка скачивается по уже полученной ссылке (0 доп. запросов);
// - для старых пользователей без сохранённой картинки сначала пробуем старую
//   ссылку, и только если она протухла — один запрос в RapidAPI, и только пока
//   в лимите остаётся больше QUOTA_RESERVE запросов.

const QUOTA_RESERVE = 10
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 5000
const MAX_IMAGE_BYTES = 512 * 1024

const lastAttempt = new Map<number, number>()
// Остаток запросов RapidAPI из последнего ответа (null — ещё не знаем).
let rapidApiRemaining: number | null = null

export function recordRapidApiQuota(headers: AxiosResponseHeaders | RawAxiosResponseHeaders) {
  const value = Number(headers['x-ratelimit-requests-remaining'])
  if (Number.isFinite(value)) rapidApiRemaining = value
}

// true, если точно знаем, что запросы RapidAPI на этот месяц закончились.
export function rapidApiExhausted(): boolean {
  return rapidApiRemaining !== null && rapidApiRemaining <= 0
}

function hasQuotaForAvatars(): boolean {
  return rapidApiRemaining === null || rapidApiRemaining > QUOTA_RESERVE
}

async function fetchInstagramProfilePicUrl(username: string): Promise<string | null> {
  const body = new URLSearchParams({ username_or_url: username.replace('@', ''), data: 'basic' })
  const response = await axios.post(
    'https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile.php',
    body.toString(),
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY!,
        'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com',
      },
    },
  )
  recordRapidApiQuota(response.headers)
  const data = response.data
  if (!data || data.error) return null
  return data.profile_pic_url || null
}

/** Скачивает картинку по ссылке Instagram CDN. null — если ссылка протухла или это не картинка. */
export async function downloadImage(url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(parsed.hostname)) return null
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAX_IMAGE_BYTES,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Referer: 'https://www.instagram.com/',
      },
    })
    const contentType = String(res.headers['content-type'] || '')
    if (!contentType.startsWith('image/')) return null
    return { bytes: Buffer.from(res.data), contentType }
  } catch {
    return null
  }
}

/** Скачивает и сохраняет картинку при регистрации. Никогда не бросает исключений. */
export async function saveAvatarFromUrl(prisma: PrismaService, userId: number, url: string | null) {
  if (!url) return false
  const image = await downloadImage(url)
  if (!image) return false
  await prisma.user.update({
    where: { id: userId },
    data: { avatarImage: image.bytes, avatarContentType: image.contentType },
  }).catch(() => undefined)
  return true
}

interface AvatarUser {
  id: number
  instagramUsername: string
  profilePicUrl: string | null
  avatarImage: Buffer | Uint8Array | null
}

/**
 * Гарантирует, что картинка аватарки сохранена (для пользователей, которые
 * зарегистрировались до появления хранения). Возвращает true, если картинка есть.
 * Никогда не бросает исключений.
 */
export async function ensureAvatarSaved(prisma: PrismaService, user: AvatarUser): Promise<boolean> {
  if (user.avatarImage) return true

  const last = lastAttempt.get(user.id)
  if (last && Date.now() - last < RETRY_COOLDOWN_MS) return false
  lastAttempt.set(user.id, Date.now())

  try {
    // 1. Старая ссылка — вдруг ещё живая (бесплатно).
    if (await saveAvatarFromUrl(prisma, user.id, user.profilePicUrl)) return true

    // 2. Свежая ссылка через RapidAPI — только если не трогаем резерв под регистрации.
    if (process.env.SKIP_INSTAGRAM_CHECK === 'true' || !process.env.RAPIDAPI_KEY) return false
    if (!hasQuotaForAvatars()) return false
    const fresh = await fetchInstagramProfilePicUrl(user.instagramUsername)
    if (!fresh) return false
    await prisma.user.update({ where: { id: user.id }, data: { profilePicUrl: fresh } }).catch(() => undefined)
    return await saveAvatarFromUrl(prisma, user.id, fresh)
  } catch {
    return false
  }
}

/** Путь к сохранённой аватарке на нашем бэкенде (фронтенд добавляет адрес API). */
export function avatarPath(userId: number, hasImage: boolean): string | null {
  return hasImage ? `/users/${userId}/avatar` : null
}
