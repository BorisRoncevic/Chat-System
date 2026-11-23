
import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
  } from '@nestjs/websockets';
  
  import { Server, Socket } from 'socket.io';
  import { randomUUID } from 'node:crypto';
  import { WsException } from '@nestjs/websockets';
  
  @WebSocketGateway({
    cors: {
      origin: 'http://localhost:3000',
    },
    transports: ['websocket'],
  })
  export class ChatGateway
    implements OnGatewayConnection, OnGatewayDisconnect
  {
    @WebSocketServer()
    server!: Server;
  
    handleConnection(client: Socket) {
      console.log('Connected:', client.id);
    }
  
    handleDisconnect(client: Socket) {
      console.log('Disconnected:', client.id);
    }
  
    @SubscribeMessage('join-room')
    async joinRoom(@ConnectedSocket() client: Socket) {
      await client.join('room:general');
  
      return { joined: true };
    }
  
    @SubscribeMessage('send-message')
    sendMessage(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { text?: unknown },
    ) {
      if (!client.rooms.has('room:general')) {
        throw new WsException('Join the room first');
      }
  
      if (
        typeof data?.text !== 'string' ||
        !data.text.trim() ||
        data.text.length > 2000
      ) {
        throw new WsException('Invalid message');
      }
  
      const message = {
        id: randomUUID(),
        senderId: client.id,
        text: data.text.trim(),
        createdAt: new Date().toISOString(),
      };
  
      this.server
        .to('room:general')
        .emit('new-message', message);
  
      return { success: true };
    }
  }
  