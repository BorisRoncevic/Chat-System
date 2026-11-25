import type { Socket } from "socket.io-client";
import type { User } from "../auth/types";

export type ChatMessage = {
  id: string;
  conversationId: number;
  senderId: string;
  clientMessageId: string;
  seq: number;
  text: string;
  createdAt: string;
};
export type Conversation = {
  id: number;
  members: { user: Pick<User, "id" | "username"> }[];
  messages?: ChatMessage[];
};
export type ChatErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_CONVERSATION"
  | "INVALID_MESSAGE"
  | "FORBIDDEN"
  | "ROOM_NOT_JOINED"
  | "NOT_FOUND"
  | "MESSAGE_CONFLICT"
  | "TEMPORARY_ERROR";
export type ChatFailure = {
  success: false;
  code: ChatErrorCode;
  error: string;
  retryable: boolean;
  clientMessageId?: string;
};
export type JoinResponse = { joined: true } | ChatFailure;
export type SendResponse =
  | { success: true; clientMessageId: string; message: ChatMessage }
  | ChatFailure;
export type DeliveryStatus = {
  state: "idle" | "sending" | "saved" | "rejected" | "unconfirmed";
  message: string;
};

export type ChatProps = {
  user: User;
  onExpired: () => void;
  onLogout: () => void;
};

export type ConversationOptions = {
  conversationId: number;
  user: User;
  socket: Socket;
  connected: boolean;
  connectionVersion: number;
  onExpired: () => void;
  joinRoom: (
    socket: Socket,
    id: number,
    signal: AbortSignal,
  ) => Promise<JoinResponse | undefined>;
};
