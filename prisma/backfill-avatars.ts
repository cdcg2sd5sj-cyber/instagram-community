// Импортируем клиент напрямую из output-пути в schema.prisma: корневой node_modules/.prisma/client
// устарел (сгенерирован до добавления недавних полей) и не будет знать про profilePicUrl.
import { PrismaClient } from '../backend/node_modules/.prisma/client'
import axios from 'axios'

const prisma = new PrismaClient()

const DELAY_MS = 1500

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchProfilePicUrl(instagramUsername: string): Promise<string | null> {
  const body = new URLSearchParams({ username_or_url: instagramUsername, data: 'basic' })
  const response = await axios.post(
    'https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile.php',
    body.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY!,
        'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com',
      },
    },
  )

  const data = response.data
  if (!data || data.error) throw new Error('Аккаунт не найден или ошибка API')
  return data.profile_pic_url || null
}

async function main() {
  const users = await prisma.user.findMany({
    where: { profilePicUrl: null },
    select: { id: true, instagramUsername: true },
  })

  console.log(`Найдено пользователей без аватарки: ${users.length}`)

  let updated = 0
  let errors = 0

  for (let i = 0; i < users.length; i++) {
    const user = users[i]
    console.log(`[${i + 1}/${users.length}] @${user.instagramUsername}...`)

    try {
      const profilePicUrl = await fetchProfilePicUrl(user.instagramUsername)
      if (profilePicUrl) {
        await prisma.user.update({
          where: { id: user.id },
          data: { profilePicUrl },
        })
        updated++
        console.log(`  OK -> ${profilePicUrl}`)
      } else {
        console.log('  Пропущено: API не вернул profile_pic_url')
      }
    } catch (e: any) {
      errors++
      console.log(`  Ошибка: ${e.message || e}`)
    }

    if (i < users.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  console.log('\nГотово!')
  console.log(`Обновлено: ${updated}`)
  console.log(`Ошибок: ${errors}`)
  console.log(`Пропущено (нет фото): ${users.length - updated - errors}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
