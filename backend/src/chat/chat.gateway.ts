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
import { HttpException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { readToken } from '../auth/utils/read-token';
import { ChatService } from './chat.service';
import type { JoinRoomInput, SendMessageInput } from './chat.types';

@WebSocketGateway({ transports: ['websocket'] })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
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

  @SubscribeMessage('join-room')
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinRoomInput,
  ) {
    if (!this.authenticated(client)) return { error: 'Prijavi se ponovo.' };
    if (
      !Number.isSafeInteger(data?.conversationId) ||
      Number(data.conversationId) < 1
    )
      return { error: 'Neispravan razgovor.' };
    const conversationId = data.conversationId as number;
    try {
      if (!(await this.chat.isMember(conversationId, client.data.userId)))
        return { error: 'Nemaš pristup ovom razgovoru.' };
      for (const room of client.rooms) {
        if (room.startsWith('conversation:')) await client.leave(room);
      }
      await client.join(`conversation:${conversationId}`);
      return { joined: true };
    } catch {
      return { error: 'Razgovor trenutno nije dostupan.' };
    }
  }

  @SubscribeMessage('send-message')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: SendMessageInput,
  ) {
    if (!this.authenticated(client)) return { error: 'Prijavi se ponovo.' };
    if (
      !Number.isSafeInteger(data?.conversationId) ||
      Number(data.conversationId) < 1 ||
      typeof data?.clientMessageId !== 'string' ||
      data.clientMessageId.length < 1 ||
      data.clientMessageId.length > 100 ||
      typeof data?.text !== 'string' ||
      !data.text.trim() ||
      data.text.length > 2000
    ) {
      return { error: 'Poruka mora imati 1–2000 znakova.' };
    }
    const conversationId = data.conversationId as number;
    const room = `conversation:${conversationId}`;
    if (!client.rooms.has(room)) return { error: 'Prvo otvori razgovor.' };
    try {
      const message = await this.chat.saveMessage(
        conversationId,
        client.data.userId,
        data.clientMessageId,
        data.text.trim(),
      );
      this.server.to(room).emit('new-message', message);
      this.notifyUsers(await this.chat.memberIds(conversationId));
      return { success: true, message };
    } catch (error) {
      return {
        error:
          error instanceof HttpException
            ? error.message
            : 'Slanje nije uspelo. Pokušaj ponovo.',
      };
    }
  }
}
