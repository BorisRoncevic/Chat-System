export type CreateConversationInput = { username?: unknown };
import type { Message } from '../generated/prisma/client';

export type JoinRoomInput = { conversationId?: unknown };
export type SendMessageInput = {
  conversationId?: unknown;
  clientMessageId?: unknown;
  text?: unknown;
};
export type ConversationLockRow = { id: number };

export type ChatErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_CONVERSATION'
  | 'INVALID_MESSAGE'
  | 'FORBIDDEN'
  | 'ROOM_NOT_JOINED'
  | 'NOT_FOUND'
  | 'MESSAGE_CONFLICT'
  | 'TEMPORARY_ERROR';

export type ChatFailure = {
  success: false;
  code: ChatErrorCode;
  error: string;
  retryable: boolean;
  clientMessageId?: string;
};

export type JoinRoomResponse = { joined: true } | ChatFailure;
export type SendMessageResponse =
  { success: true; clientMessageId: string; message: Message } | ChatFailure;
