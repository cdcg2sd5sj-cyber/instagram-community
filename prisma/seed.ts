import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  const admin = await prisma.user.upsert({
    where: { telegramId: 'admin_001' },
    update: {},
    create: {
      telegramId: 'admin_001',
      firstName: 'Admin',
      username: 'admin',
      instagramUsername: 'reelsboost_official',
      instagramVerified: true,
      balance: 9999,
      rating: 100,
      referralCode: 'ADMIN001',
    },
  })

  console.log('Admin created:', admin.id)

  const campaigns = [
    { reelsUrl: 'https://instagram.com/reel/PLACEHOLDER_1', totalSlots: 30 },
    { reelsUrl: 'https://instagram.com/reel/PLACEHOLDER_2', totalSlots: 25 },
    { reelsUrl: 'https://instagram.com/reel/PLACEHOLDER_3', totalSlots: 20 },
    { reelsUrl: 'https://instagram.com/reel/PLACEHOLDER_4', totalSlots: 30 },
    { reelsUrl: 'https://instagram.com/reel/PLACEHOLDER_5', totalSlots: 15 },
  ]

  for (const c of campaigns) {
    await prisma.campaign.create({
      data: {
        userId: admin.id,
        reelsUrl: c.reelsUrl,
        totalSlots: c.totalSlots,
        creditsPerTask: 15,
        status: 'ACTIVE',
      },
    })
  }

  console.log(`${campaigns.length} campaigns created`)
  console.log('Seeding complete!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
