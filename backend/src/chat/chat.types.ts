export type CreateConversationInput = { username?: unknown };
export type JoinRoomInput = { conversationId?: unknown };
export type SendMessageInput = {
  conversationId?: unknown;
  clientMessageId?: unknown;
  text?: unknown;
};
export type ConversationLockRow = { id: number };
