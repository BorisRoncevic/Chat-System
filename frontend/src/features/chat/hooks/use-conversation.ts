import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { ACK_TIMEOUT_MS } from "../constants";
import { mergeMessages } from "../utils/messages";
import type {
  ChatMessage,
  ConversationOptions,
  DeliveryStatus,
  SendResponse,
} from "../types";

export function useConversation({
  conversationId,
  user,
  socket,
  connected,
  connectionVersion,
  onExpired,
  joinRoom,
}: ConversationOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [delivery, setDelivery] = useState<DeliveryStatus>({
    state: "idle",
    message: "",
  });
  const [error, setError] = useState("");
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lifetime = useRef<AbortSignal | null>(null);
  const inFlight = useRef(false);
  const pending = useRef<{ clientMessageId: string; text: string } | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller.signal;
    const receive = (message: ChatMessage) => {
      if (
        !controller.signal.aborted &&
        message.conversationId === conversationId
      ) {
        setMessages((previous) => mergeMessages(previous, [message]));
      }
    };
    socket.on("new-message", receive);
    const disconnected = () => {
      controller.abort();
      setJoined(false);
      setLoading(false);
      setLoadingOlder(false);
      inFlight.current = false;
      setDelivery((current) =>
        current.state === "sending"
          ? {
              state: "unconfirmed",
              message:
                "Veza je prekinuta pre potvrde. Poruka je možda sačuvana; tekst je zadržan.",
            }
          : current,
      );
    };
    const reconnected = () => {
      setJoined(false);
      setLoading(true);
    };
    socket.on("disconnect", disconnected);
    socket.on("connect", reconnected);

    async function open() {
      try {
        const response = await joinRoom(
          socket,
          conversationId,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (response && "success" in response && !response.success) {
          if (response.code === "UNAUTHORIZED") {
            onExpired();
            return;
          }
          throw new Error(response.error);
        }
        if (!response || !("joined" in response) || !response.joined)
          throw new Error("Ulazak u razgovor nije uspeo.");
        const history = await api<ChatMessage[]>(
          `/conversations/${conversationId}/messages`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setMessages((previous) => mergeMessages(previous, history));
        setHasOlder(history.length === 100);
        setJoined(true);
        setError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) onExpired();
        else setError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    if (connected) void open();
    return () => {
      controller.abort();
      socket.off("new-message", receive);
      socket.off("disconnect", disconnected);
      socket.off("connect", reconnected);
    };
  }, [
    conversationId,
    socket,
    connected,
    connectionVersion,
    onExpired,
    joinRoom,
    attempt,
  ]);

  async function older() {
    const signal = lifetime.current;
    if (
      !connected ||
      !signal ||
      signal.aborted ||
      loadingOlder ||
      !messages.length
    )
      return;
    setLoadingOlder(true);
    try {
      const history = await api<ChatMessage[]>(
        `/conversations/${conversationId}/messages?before=${messages[0].seq}`,
        { signal },
      );
      if (signal.aborted) return;
      setMessages((previous) => mergeMessages(previous, history));
      setHasOlder(history.length === 100);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onExpired();
      else setError(errorMessage(error));
    } finally {
      if (!signal.aborted) setLoadingOlder(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = text.trim();
    const signal = lifetime.current;
    if (
      !body ||
      !joined ||
      inFlight.current ||
      !socket.connected ||
      !signal ||
      signal.aborted
    )
      return;
    inFlight.current = true;
    setDelivery({ state: "sending", message: "Čekam potvrdu čuvanja poruke…" });
    setError("");
    if (pending.current?.text !== body) {
      pending.current = { clientMessageId: crypto.randomUUID(), text: body };
    }
    const payload = { conversationId, ...pending.current };
    try {
      const response: SendResponse | undefined = await socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck("send-message", payload);
      if (signal.aborted) return;
      if (!response || response.clientMessageId !== payload.clientMessageId) {
        throw new Error("INVALID_ACK");
      }
      if (response.success === false) {
        if (
          typeof response.code !== "string" ||
          typeof response.error !== "string" ||
          typeof response.retryable !== "boolean"
        ) {
          throw new Error("INVALID_ACK");
        }
        if (response.code === "UNAUTHORIZED") {
          onExpired();
          return;
        }
        setDelivery({
          state: response.retryable ? "unconfirmed" : "rejected",
          message: response.retryable
            ? `${response.error} Tekst je zadržan.`
            : `Slanje je odbijeno: ${response.error}`,
        });
        if (!response.retryable) pending.current = null;
        if (response.code === "ROOM_NOT_JOINED") setJoined(false);
        return;
      }
      const message = response.message;
      if (
        response.success !== true ||
        !message ||
        typeof message.id !== "string" ||
        message.clientMessageId !== payload.clientMessageId ||
        message.conversationId !== conversationId ||
        message.senderId !== user.id ||
        message.text !== body ||
        !Number.isSafeInteger(message.seq) ||
        message.seq < 1 ||
        typeof message.createdAt !== "string"
      ) {
        throw new Error("INVALID_ACK");
      }
      setMessages((previous) => mergeMessages(previous, [message]));
      setText("");
      pending.current = null;
      setDelivery({ state: "saved", message: "Poruka je sačuvana." });
    } catch (error) {
      if (!signal.aborted) {
        const message =
          error instanceof Error && error.message === "INVALID_ACK"
            ? "Server nije vratio ispravnu potvrdu. Tekst je zadržan."
            : !socket.connected
              ? "Veza je prekinuta pre potvrde. Poruka je možda sačuvana; tekst je zadržan."
              : "Potvrda nije stigla u roku od 5 sekundi. Poruka je možda sačuvana; tekst je zadržan.";
        setDelivery({ state: "unconfirmed", message });
      }
    } finally {
      if (!signal.aborted) inFlight.current = false;
    }
  }

  function retryJoin() {
    setLoading(true);
    setError("");
    setAttempt((current) => current + 1);
  }

  function changeText(value: string) {
    setText(value);
    setDelivery({ state: "idle", message: "" });
  }

  return {
    messages,
    joined,
    loading,
    text,
    delivery,
    error,
    hasOlder,
    loadingOlder,
    older,
    send,
    retryJoin,
    changeText,
  };
}
