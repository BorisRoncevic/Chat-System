import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthRequest } from '../auth/auth.types';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import type { CreateConversationInput } from './chat.types';

@Controller('conversations')
@UseGuards(OriginGuard, AuthGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get()
  list(@Req() request: AuthRequest) {
    return this.chat.listConversations(request.user.id);
  }

  @Post()
  async create(
    @Req() request: AuthRequest,
    @Body() data: CreateConversationInput,
  ) {
    const conversation = await this.chat.createPrivateConversation(
      request.user.id,
      data?.username,
    );
    this.gateway.notifyUsers(
      conversation.members.map((member) => member.user.id),
    );
    return conversation;
  }

  @Get(':conversationId/messages')
  getMessages(
    @Req() request: AuthRequest,
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Query('before') before?: string,
  ) {
    const beforeSeq = before === undefined ? undefined : Number(before);
    if (
      conversationId < 1 ||
      (beforeSeq !== undefined &&
        (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1))
    ) {
      throw new BadRequestException('Neispravan razgovor ili broj poruke.');
    }
    return this.chat.getMessages(conversationId, request.user.id, beforeSeq);
  }
}
