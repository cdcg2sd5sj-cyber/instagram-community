import axios from 'axios'
import { PrismaService } from '../prisma/prisma.service'

// Ссылки на фото профиля с CDN Instagram подписаны и живут ограниченное время:
// параметр `oe` — это unix-время истечения в hex. После него CDN отвечает 403,
// и аватарка в приложении пропадает. Поэтому сохранённую при регистрации ссылку
// нужно периодически обновлять.

// Обновляем заранее, за сутки до истечения.
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000
// Не дёргаем RapidAPI для одного пользователя чаще раза в 6 часов,
// даже если прошлая попытка не удалась.
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 5000

const lastAttempt = new Map<number, number>()

export function isAvatarStale(url: string | null | undefined): boolean {
  if (!url) return true
  try {
    const oe = new URL(url).searchParams.get('oe')
    if (!oe) return false
    const expiresAt = parseInt(oe, 16) * 1000
    if (Number.isNaN(expiresAt)) return false
    return expiresAt - Date.now() < REFRESH_MARGIN_MS
  } catch {
    return true
  }
}

export async function fetchInstagramProfilePic(username: string): Promise<string | null> {
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
  const data = response.data
  if (!data || data.error) return null
  return data.profile_pic_url || null
}

interface AvatarUser {
  id: number
  instagramUsername: string
  profilePicUrl: string | null
}

/**
 * Возвращает актуальную ссылку на аватарку: если сохранённая истекла
 * (или скоро истечёт) — запрашивает свежую в Instagram и сохраняет в БД.
 * Никогда не бросает исключений: при любой ошибке возвращает старую ссылку.
 */
export async function refreshAvatarIfStale(prisma: PrismaService, user: AvatarUser): Promise<string | null> {
  if (process.env.SKIP_INSTAGRAM_CHECK === 'true' || !process.env.RAPIDAPI_KEY) return user.profilePicUrl
  if (!isAvatarStale(user.profilePicUrl)) return user.profilePicUrl

  const last = lastAttempt.get(user.id)
  if (last && Date.now() - last < RETRY_COOLDOWN_MS) return user.profilePicUrl
  lastAttempt.set(user.id, Date.now())

  try {
    const fresh = await fetchInstagramProfilePic(user.instagramUsername)
    if (!fresh || fresh === user.profilePicUrl) return user.profilePicUrl
    await prisma.user.update({ where: { id: user.id }, data: { profilePicUrl: fresh } })
    return fresh
  } catch {
    return user.profilePicUrl
  }
}
