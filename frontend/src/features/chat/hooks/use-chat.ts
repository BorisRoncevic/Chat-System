import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { API_URL } from "../../../lib/config";
import { SESSION_EXPIRED } from "../../auth/constants";
import { ACK_TIMEOUT_MS } from "../constants";
import type { ChatProps, Conversation, JoinResponse } from "../types";

export function useChat({
  onExpired,
  onLogout,
}: Pick<ChatProps, "onExpired" | "onLogout">) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [connection, setConnection] = useState<{
    socket: Socket;
    version: number;
    connected: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [recipient, setRecipient] = useState("");
  const [creating, setCreating] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const refreshId = useRef(0);
  const lifetime = useRef<AbortSignal | null>(null);
  const joinQueue = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(
    (signal?: AbortSignal) => {
      const requestId = ++refreshId.current;
      return api<Conversation[]>("/conversations", { signal })
        .then((data) => {
          if (signal?.aborted || requestId !== refreshId.current) return;
          setConversations(data);
          setSelectedId((current) =>
            data.some((item) => item.id === current)
              ? current
              : (data[0]?.id ?? null),
          );
          setError("");
        })
        .catch((error) => {
          if (signal?.aborted || requestId !== refreshId.current) return;
          if (error instanceof ApiError && error.status === 401) onExpired();
          else setError(errorMessage(error));
        })
        .finally(() => {
          if (!signal?.aborted && requestId === refreshId.current)
            setLoading(false);
        });
    },
    [onExpired],
  );

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller.signal;
    const socket = io(API_URL, {
      transports: ["websocket"],
      withCredentials: true,
    });
    socketRef.current = socket;
    let version = 0;
    void refresh(controller.signal);

    socket.on("connect", () => {
      if (controller.signal.aborted) return;
      setConnection({ socket, version: ++version, connected: true });
      setConnectionError("");
      void refresh(controller.signal);
    });
    socket.on("disconnect", () => {
      if (!controller.signal.aborted)
        setConnection((current) =>
          current ? { ...current, connected: false } : null,
        );
    });
    socket.on("connect_error", (error) => {
      if (controller.signal.aborted) return;
      if (error.message === SESSION_EXPIRED) onExpired();
      else
        setConnectionError("Veza je prekinuta. Pokušavam ponovno povezivanje…");
    });
    socket.on("session-expired", onExpired);
    socket.on("conversations-updated", () => void refresh(controller.signal));

    return () => {
      controller.abort();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [refresh, onExpired]);

  const joinRoom = useCallback(
    (socket: Socket, conversationId: number, signal: AbortSignal) => {
      const request = joinQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (signal.aborted) return undefined;
          return (await socket
            .timeout(ACK_TIMEOUT_MS)
            .emitWithAck("join-room", { conversationId })) as JoinResponse;
        });
      joinQueue.current = request;
      return request;
    },
    [],
  );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const signal = lifetime.current;
    if (!signal || signal.aborted) return;
    setCreating(true);
    setError("");
    try {
      const conversation = await api<Conversation>("/conversations", {
        method: "POST",
        body: JSON.stringify({ username: recipient.trim() }),
        signal,
      });
      if (signal.aborted) return;
      setConversations((previous) => [
        conversation,
        ...previous.filter((item) => item.id !== conversation.id),
      ]);
      setSelectedId(conversation.id);
      setRecipient("");
      await refresh(signal);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onExpired();
      else setError(errorMessage(error));
    } finally {
      if (!signal.aborted) setCreating(false);
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setError("");
    try {
      await api("/auth/logout", { method: "POST" });
      socketRef.current?.disconnect();
      onLogout();
    } catch (error) {
      setError(errorMessage(error));
      setLoggingOut(false);
    }
  }

  const selected = conversations.find(
    (conversation) => conversation.id === selectedId,
  );

  function refreshConversations() {
    void refresh(lifetime.current ?? undefined);
  }

  return {
    conversations,
    selectedId,
    selected,
    connection,
    loading,
    recipient,
    creating,
    loggingOut,
    error,
    connectionError,
    setRecipient,
    setSelectedId,
    create,
    logout,
    joinRoom,
    refreshConversations,
  };
}
