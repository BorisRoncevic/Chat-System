"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import styles from "./page.module.css";

type ChatMessage = {
  id: string;
  conversationId: number;
  senderId: string;
  clientMessageId: string;
  seq: number;
  text: string;
  createdAt: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const CONVERSATION_ID = 1;

function mergeMessages(
  previous: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();

  for (const message of [...previous, ...incoming]) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export default function Home() {
  const socketRef = useRef<Socket | null>(null);

  const [userId, setUserId] = useState("alice");
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const currentUser = params.get("user") === "bob" ? "bob" : "alice";

    let active = true;

    const socket = io(API_URL, {
      transports: ["websocket"],
      auth: {
        userId: currentUser,
      },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setUserId(currentUser);
      setConnected(true);
      setError("");

      socket.emit(
        "join-room",
        { conversationId: CONVERSATION_ID },
        async (response: { joined?: boolean }) => {
          if (!active) return;

          if (!response?.joined) {
            setError("Could not join conversation");
            return;
          }

          setJoined(true);

          try {
            const res = await fetch(
              `${API_URL}/conversations/${CONVERSATION_ID}/messages?userId=${currentUser}`,
              { cache: "no-store" },
            );

            if (!res.ok) {
              throw new Error("Failed to load messages");
            }

            const history = (await res.json()) as ChatMessage[];

            if (!active) return;

            setMessages((prev) => mergeMessages(prev, history));
          } catch {
            if (active) {
              setError("Failed to load chat history");
            }
          }
        },
      );
    });

    socket.on("new-message", (message: ChatMessage) => {
      setMessages((prev) => mergeMessages(prev, [message]));
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setJoined(false);
    });

    socket.on("connect_error", (err) => {
      setError(err.message);
    });

    socket.on("exception", (err: { message?: string }) => {
      setError(err?.message ?? "Chat error");
    });

    return () => {
      active = false;
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  function sendMessage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const messageText = text.trim();

    if (!messageText || !joined) return;

    socketRef.current?.emit("send-message", {
      conversationId: CONVERSATION_ID,
      clientMessageId: crypto.randomUUID(),
      text: messageText,
    });

    setText("");
  }

  return (
    <main className={styles.container}>
      <h1>Chat System</h1>
      <p>
        Logged in as: <strong>{userId}</strong>
      </p>
      <p>
        Connection:{" "}
        <strong>
          {connected && joined ? "🟢 Connected" : "🔴 Disconnected"}
        </strong>
      </p>
      {error && <p className={styles.error}>{error}</p>}
      <h2>Conversation #{CONVERSATION_ID}</h2>
      <div className={styles.list}>
        {messages.map((message) => {
          const isMine = message.senderId === userId;

          return (
            <div
              key={message.id}
              className={`${styles.row} ${isMine ? styles.mine : ""}`}
            >
              <div className={styles.bubble}>
                <small>
                  {message.senderId} · #{message.seq}
                </small>
                <div className={styles.text}>{message.text}</div>
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={sendMessage} className={styles.form}>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write a message..."
          className={styles.input}
        />
        <button
          disabled={!joined || !text.trim()}
          type="submit"
          className={styles.button}
        >
          Send
        </button>
      </form>
    </main>
  );
}
