import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { HttpException, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { readToken } from '../auth/utils/read-token';
import { ChatService } from './chat.service';
import type { Message } from '../generated/prisma/client';
import type {
  ChatErrorCode,
  ChatFailure,
  JoinRoomInput,
  JoinRoomResponse,
  SendMessageInput,
  SendMessageResponse,
} from './chat.types';

@WebSocketGateway({ transports: ['websocket'] })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private readonly expirationTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(
    private readonly chat: ChatService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Server) {
    server.use(async (client, next) => {
      try {
        const origin = client.handshake.headers.origin;
        if (
          origin &&
          origin !== this.config.get('FRONTEND_URL', 'http://localhost:3000')
        )
          throw new Error('Origin');
        const session = await this.auth.authenticate(
          readToken(
            client.handshake.headers.cookie,
            client.handshake.headers.authorization,
          ),
        );
        client.data.userId = session.user.id;
        client.data.expiresAt = session.expiresAt;
        next();
      } catch {
        next(new Error('Prijavi se ponovo.'));
      }
    });
  }

  handleConnection(client: Socket) {
    void client.join(`user:${client.data.userId}`);
    const timer = setTimeout(
      () => {
        client.emit('session-expired');
        client.disconnect(true);
      },
      Math.max(0, client.data.expiresAt - Date.now()),
    );
    timer.unref();
    this.expirationTimers.set(client.id, timer);
  }

  handleDisconnect(client: Socket) {
    clearTimeout(this.expirationTimers.get(client.id));
    this.expirationTimers.delete(client.id);
  }

  notifyUsers(userIds: string[]) {
    this.server
      .to(userIds.map((id) => `user:${id}`))
      .emit('conversations-updated');
  }

  private authenticated(client: Socket) {
    return (
      typeof client.data.userId === 'string' &&
      client.data.expiresAt > Date.now()
    );
  }

  private failure(
    code: ChatErrorCode,
    error: string,
    clientMessageId?: string,
  ): ChatFailure {
    return {
      success: false,
      code,
      error,
      retryable: code === 'TEMPORARY_ERROR',
      ...(clientMessageId ? { clientMessageId } : {}),
    };
  }

  private async publishMessage(message: Message) {
    try {
      this.server
        .to(`conversation:${message.conversationId}`)
        .emit('new-message', message);
    } catch {
      this.logger.warn(`Broadcast failed for saved message ${message.id}`);
    }

    try {
      this.notifyUsers(await this.chat.memberIds(message.conversationId));
    } catch {
      this.logger.warn(
        `Conversation notification failed for saved message ${message.id}`,
      );
    }
  }

  @SubscribeMessage('join-room')
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinRoomInput,
  ): Promise<JoinRoomResponse> {
    if (!this.authenticated(client))
      return this.failure('UNAUTHORIZED', 'Prijavi se ponovo.');
    if (
      !Number.isSafeInteger(data?.conversationId) ||
      Number(data.conversationId) < 1
    )
      return this.failure('INVALID_CONVERSATION', 'Neispravan razgovor.');
    const conversationId = data.conversationId as number;
    try {
      if (!(await this.chat.isMember(conversationId, client.data.userId)))
        return this.failure('FORBIDDEN', 'Nemaš pristup ovom razgovoru.');
      for (const room of client.rooms) {
        if (room.startsWith('conversation:')) await client.leave(room);
      }
      await client.join(`conversation:${conversationId}`);
      return { joined: true };
    } catch {
      return this.failure(
        'TEMPORARY_ERROR',
        'Razgovor trenutno nije dostupan.',
      );
    }
  }

  @SubscribeMessage('send-message')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: SendMessageInput,
  ): Promise<SendMessageResponse> {
    const clientMessageId =
      typeof data?.clientMessageId === 'string' &&
      data.clientMessageId.length <= 100
        ? data.clientMessageId
        : undefined;

    if (!this.authenticated(client))
      return this.failure(
        'UNAUTHORIZED',
        'Prijavi se ponovo.',
        clientMessageId,
      );
    if (
      !Number.isSafeInteger(data?.conversationId) ||
      Number(data.conversationId) < 1
    ) {
      return this.failure(
        'INVALID_CONVERSATION',
        'Neispravan razgovor.',
        clientMessageId,
      );
    }
    if (
      typeof data?.clientMessageId !== 'string' ||
      data.clientMessageId.length < 1 ||
      data.clientMessageId.length > 100 ||
      typeof data?.text !== 'string' ||
      !data.text.trim() ||
      data.text.length > 2000
    ) {
      return this.failure(
        'INVALID_MESSAGE',
        'Poruka mora imati 1–2000 znakova i ispravan ID.',
        clientMessageId,
      );
    }
    const conversationId = data.conversationId as number;
    const room = `conversation:${conversationId}`;
    if (!client.rooms.has(room))
      return this.failure(
        'ROOM_NOT_JOINED',
        'Prvo otvori razgovor.',
        clientMessageId,
      );
    try {
      const message = await this.chat.saveMessage(
        conversationId,
        client.data.userId,
        data.clientMessageId,
        data.text.trim(),
      );
      void this.publishMessage(message);
      return {
        success: true,
        clientMessageId: message.clientMessageId,
        message,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        switch (error.getStatus()) {
          case 400:
            return this.failure(
              'INVALID_MESSAGE',
              'Poruka nije ispravna.',
              clientMessageId,
            );
          case 401:
            return this.failure(
              'UNAUTHORIZED',
              'Prijavi se ponovo.',
              clientMessageId,
            );
          case 403:
            return this.failure(
              'FORBIDDEN',
              'Nemaš pristup ovom razgovoru.',
              clientMessageId,
            );
          case 404:
            return this.failure(
              'NOT_FOUND',
              'Razgovor nije pronađen.',
              clientMessageId,
            );
          case 409:
            return this.failure(
              'MESSAGE_CONFLICT',
              'Isti ID poruke je već upotrebljen za drugi tekst.',
              clientMessageId,
            );
        }
      }
      return this.failure(
        'TEMPORARY_ERROR',
        'Server trenutno ne može da potvrdi čuvanje poruke.',
        clientMessageId,
      );
    }
  }
}
