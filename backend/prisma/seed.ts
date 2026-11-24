import 'dotenv/config';

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.user.upsert({
    where: { id: 'alice' },
    update: {},
    create: {
      id: 'alice',
      username: 'alice',
      email: 'alice@example.test',
    },
  });

  await prisma.user.upsert({
    where: { id: 'bob' },
    update: {},
    create: {
      id: 'bob',
      username: 'bob',
      email: 'bob@example.test',
    },
  });

  await prisma.conversation.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  for (const userId of ['alice', 'bob']) {
    await prisma.conversationMember.upsert({
      where: {
        userId_conversationId: {
          userId,
          conversationId: 1,
        },
      },
      update: {},
      create: {
        userId,
        conversationId: 1,
      },
    });
  }

  console.log('Demo users and conversation created');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });