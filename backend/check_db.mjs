import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const msgs = await prisma.message.findMany({
    where: {
      OR: [
        { content: { contains: 'quote' } },
        { content: { contains: 'reply' } },
        { content: { contains: 'quoteMsg' } },
        { content: { contains: 'attach' } },
      ]
    },
    take: 10
  });
  console.log('Found:', msgs.length);
  for (const m of msgs) {
    console.log(m.id, m.content);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
