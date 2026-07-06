import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const REAL_REELS = [
  'https://www.instagram.com/reel/DaZWdYRokJF/',
  'https://www.instagram.com/reel/DaX4l2LtFa9/',
  'https://www.instagram.com/reel/DaZuiwZxCn2/',
  'https://www.instagram.com/reel/DaXoSVLRKl_/',
  'https://www.instagram.com/reel/DaV_9ZJhzR9/',
  'https://www.instagram.com/reel/DaYJAWatPtJ/',
  'https://www.instagram.com/reel/DaYbWzThH64/',
  'https://www.instagram.com/reel/DaYFMVZN4zj/',
  'https://www.instagram.com/reel/DaY_ZTTtbRI/',
  'https://www.instagram.com/reel/DYugwdcAKLH/',
]

async function main() {
  const admin = await prisma.user.findUnique({ where: { telegramId: 'admin_001' } })
  if (!admin) {
    throw new Error('Admin-пользователь не найден — сначала запусти prisma/seed.ts')
  }

  const placeholders = await prisma.campaign.findMany({
    where: { userId: admin.id, reelsUrl: { contains: 'PLACEHOLDER' } },
    orderBy: { id: 'asc' },
  })

  console.log(`Найдено плейсхолдеров: ${placeholders.length}`)

  for (let i = 0; i < placeholders.length; i++) {
    const url = REAL_REELS[i]
    await prisma.campaign.update({
      where: { id: placeholders[i].id },
      data: { reelsUrl: url },
    })
    console.log(`  Кампания #${placeholders[i].id} -> ${url}`)
  }

  const remaining = REAL_REELS.slice(placeholders.length)
  console.log(`\nДобавляем ещё ${remaining.length} новых кампаний:`)

  for (const url of remaining) {
    const created = await prisma.campaign.create({
      data: {
        userId: admin.id,
        reelsUrl: url,
        totalSlots: 20,
        creditsPerTask: 15,
        status: 'ACTIVE',
      },
    })
    console.log(`  Кампания #${created.id} -> ${url}`)
  }

  console.log('\nГотово!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
