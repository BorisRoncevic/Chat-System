import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Server, Socket } from 'socket.io';
import type { AuthService } from '../auth/auth.service';
import type { Message } from '../generated/prisma/client';
import { ChatGateway } from './chat.gateway';
import type { ChatService } from './chat.service';

const payload = {
  conversationId: 7,
  clientMessageId: 'client-message-1',
  text: 'Ćao!',
};
const message: Message = {
  id: 'message-1',
  ...payload,
  senderId: 'alice-id',
  seq: 1,
  createdAt: new Date(),
};

function createGateway() {
  const chat = {
    saveMessage: jest
      .fn<
        ReturnType<ChatService['saveMessage']>,
        Parameters<ChatService['saveMessage']>
      >()
      .mockResolvedValue(message),
    memberIds: jest
      .fn<
        ReturnType<ChatService['memberIds']>,
        Parameters<ChatService['memberIds']>
      >()
      .mockResolvedValue(['alice-id', 'bob-id']),
  };
  const gateway = new ChatGateway(
    chat as unknown as ChatService,
    {} as AuthService,
    {} as ConfigService,
  );
  const emit = jest.fn();
  gateway.server = { to: jest.fn(() => ({ emit })) } as unknown as Server;
  const client = {
    data: { userId: 'alice-id', expiresAt: Date.now() + 60000 },
    rooms: new Set(['conversation:7']),
  } as unknown as Socket;
  return { gateway, chat, client, emit };
}

describe('ChatGateway acknowledgements', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('acknowledges success only after persistence completes', async () => {
    const { gateway, chat, client, emit } = createGateway();
    let finishSave!: (value: Message) => void;
    chat.saveMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSave = resolve;
      }),
    );
    let settled = false;
    const result = gateway.sendMessage(client, payload).then((ack) => {
      settled = true;
      return ack;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    finishSave(message);
    expect(await result).toEqual({
      success: true,
      clientMessageId: payload.clientMessageId,
      message,
    });
  });

  it('returns a successful acknowledgement without waiting for conversation notifications', async () => {
    const { gateway, chat, client } = createGateway();
    let finishLookup!: (value: string[]) => void;
    chat.memberIds.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLookup = resolve;
      }),
    );
    const result = await gateway.sendMessage(client, payload);
    expect(result.success).toBe(true);
    finishLookup(['alice-id', 'bob-id']);
  });

  it('still acknowledges a saved message if broadcasting or list notification fails', async () => {
    const { gateway, chat, client, emit } = createGateway();
    emit.mockImplementationOnce(() => {
      throw new Error('adapter unavailable');
    });
    chat.memberIds.mockRejectedValueOnce(new Error('lookup failed'));
    expect(await gateway.sendMessage(client, payload)).toEqual({
      success: true,
      clientMessageId: payload.clientMessageId,
      message,
    });
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    [new ForbiddenException(), 'FORBIDDEN', false],
    [new NotFoundException(), 'NOT_FOUND', false],
    [new ConflictException(), 'MESSAGE_CONFLICT', false],
    [new Error('private database details'), 'TEMPORARY_ERROR', true],
  ])(
    'returns a structured error when persistence rejects with %s',
    async (error, code, retryable) => {
      const { gateway, chat, client, emit } = createGateway();
      chat.saveMessage.mockRejectedValueOnce(error);
      const result = await gateway.sendMessage(client, payload);
      expect(result).toMatchObject({
        success: false,
        code,
        retryable,
        clientMessageId: payload.clientMessageId,
      });
      expect(result).toHaveProperty('error', expect.any(String));
      expect(JSON.stringify(result)).not.toContain('private database details');
      expect(emit).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ ...payload, conversationId: 0 }, 'INVALID_CONVERSATION'],
    [{ ...payload, text: ' ' }, 'INVALID_MESSAGE'],
    [{ ...payload, text: 'a'.repeat(2001) }, 'INVALID_MESSAGE'],
    [{ ...payload, clientMessageId: '' }, 'INVALID_MESSAGE'],
  ])(
    'rejects invalid input with %s before accessing the database',
    async (data, code) => {
      const { gateway, chat, client } = createGateway();
      expect(await gateway.sendMessage(client, data)).toMatchObject({
        success: false,
        code,
        retryable: false,
      });
      expect(chat.saveMessage).not.toHaveBeenCalled();
    },
  );

  it('returns UNAUTHORIZED for an expired session', async () => {
    const { gateway, chat, client } = createGateway();
    client.data.expiresAt = Date.now() - 1;
    expect(await gateway.sendMessage(client, payload)).toMatchObject({
      success: false,
      code: 'UNAUTHORIZED',
      retryable: false,
      clientMessageId: payload.clientMessageId,
    });
    expect(chat.saveMessage).not.toHaveBeenCalled();
  });

  it('returns ROOM_NOT_JOINED before attempting to save', async () => {
    const { gateway, chat, client } = createGateway();
    client.rooms.clear();
    expect(await gateway.sendMessage(client, payload)).toMatchObject({
      success: false,
      code: 'ROOM_NOT_JOINED',
      retryable: false,
    });
    expect(chat.saveMessage).not.toHaveBeenCalled();
  });
});
