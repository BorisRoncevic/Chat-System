import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import styles from "../chat.module.css";
import ui from "../../../styles/ui.module.css";

type Props = {
  messages: ChatMessage[];
  userId: string;
  connected: boolean;
  joined: boolean;
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
};

export function MessageList({
  messages,
  userId,
  connected,
  joined,
  loading,
  hasOlder,
  loadingOlder,
  onLoadOlder,
}: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [lastId]);

  return (
    <div className={styles.list} aria-label="Poruke">
      {hasOlder && (
        <button
          className={ui.secondary}
          disabled={!connected || loadingOlder}
          onClick={onLoadOlder}
        >
          {loadingOlder ? "Učitavanje…" : "Učitaj starije poruke"}
        </button>
      )}
      {loading && (
        <p className={ui.muted} role="status">
          Učitavanje poruka…
        </p>
      )}
      {!loading && joined && !messages.length && (
        <p className={ui.muted}>Još nema poruka. Pošalji prvi pozdrav.</p>
      )}
      {messages.map((message) => (
        <div
          key={message.id}
          className={`${styles.row} ${message.senderId === userId ? styles.mine : ""}`}
        >
          <div className={styles.bubble}>
            <p className={styles.text}>{message.text}</p>
            <time dateTime={message.createdAt}>
              {new Date(message.createdAt).toLocaleTimeString("sr-Latn", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>
        </div>
      ))}
      <div ref={bottom} />
    </div>
  );
}
