import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';

import { PrismaModule } from '../prisma/prisma.module';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [ChatGateway, ChatService],
  controllers: [ChatController],
})
export class ChatModule {}
