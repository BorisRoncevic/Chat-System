import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { ConversationLockRow } from './chat.types';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: {
        directKey: { not: null },
        members: { some: { userId: userId } },
      },
      select: {
        id: true,
        members: {
          select: {
            user: {
              select: { id: true, username: true },
            },
          },
        },
        messages: {
          orderBy: { seq: 'desc' },
          take: 1,
        },
      },
      orderBy: { id: 'desc' },
    });
  }

  async createPrivateConversation(userId: string, username: unknown) {
    if (typeof username !== 'string') {
      throw new BadRequestException('Unesi korisničko ime primaoca.');
    }

    const recipientUsername = username.trim().toLowerCase();
    const usernamePattern = /^[a-z0-9_]{3,30}$/;

    if (!usernamePattern.test(recipientUsername)) {
      throw new BadRequestException('Unesi korisničko ime primaoca.');
    }

    const recipient = await this.prisma.user.findUnique({
      where: {
        username: recipientUsername,
      },
    });

    if (!recipient?.passwordHash) {
      throw new NotFoundException('Korisnik nije pronađen.');
    }

    if (recipient.id === userId) {
      throw new BadRequestException('Izaberi drugog korisnika.');
    }

    const participantIds = [userId, recipient.id].sort();
    const directKey = JSON.stringify(participantIds);

    const include = {
      members: {
        select: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      },
    } as const;

    try {
      return await this.prisma.conversation.upsert({
        where: {
          directKey: directKey,
        },
        update: {},
        create: {
          directKey: directKey,
          members: {
            create: [
              { userId: userId },
              { userId: recipient.id },
            ],
          },
        },
        include: include,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        return this.prisma.conversation.findUniqueOrThrow({
          where: {
            directKey: directKey,
          },
          include: include,
        });
      }

      throw error;
    }
  }

  async memberIds(conversationId: number) {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  async isMember(conversationId: number, userId: string): Promise<boolean> {
    const member = await this.prisma.conversationMember.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId,
        },
      },
    });

    return member !== null;
  }

  async getMessages(
    conversationId: number,
    userId: string,
    beforeSeq?: number,
  ) {
    const allowed = await this.isMember(conversationId, userId);

    if (!allowed) {
      throw new ForbiddenException('No access to this conversation');
    }

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(beforeSeq ? { seq: { lt: beforeSeq } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: 100,
    });
    return messages.reverse();
  }

  async saveMessage(
    conversationId: number,
    senderId: string,
    clientMessageId: string,
    text: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.conversationMember.findUnique({
        where: {
          userId_conversationId: {
            userId: senderId,
            conversationId,
          },
        },
      });

      if (!member) {
        throw new ForbiddenException();
      }

      const rows = await tx.$queryRaw<ConversationLockRow[]>`
          SELECT id
          FROM "Conversation"
          WHERE id = ${conversationId}
          FOR UPDATE
        `;

      if (rows.length === 0) {
        throw new NotFoundException();
      }

      const existing = await tx.message.findUnique({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId,
            senderId,
            clientMessageId,
          },
        },
      });

      if (existing) {
        if (existing.text !== text) {
          throw new ConflictException('Same message ID, different text');
        }

        return existing;
      }

      const conversation = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastSeq: { increment: 1 },
        },
      });

      return tx.message.create({
        data: {
          conversationId,
          senderId,
          clientMessageId,
          seq: conversation.lastSeq,
          text,
        },
      });
    });
  }
}
