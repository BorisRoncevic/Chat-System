"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import styles from "./page.module.css";

type User = { id: string; username: string; email: string };
type ChatMessage = {
  id: string;
  conversationId: number;
  senderId: string;
  clientMessageId: string;
  seq: number;
  text: string;
  createdAt: string;
};
type Conversation = {
  id: number;
  members: { user: Pick<User, "id" | "username"> }[];
  messages?: ChatMessage[];
};
type JoinResponse = { joined?: boolean; error?: string };
type SendResponse = {
  success?: boolean;
  message?: ChatMessage;
  error?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const SESSION_EXPIRED = "Prijavi se ponovo.";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(
      typeof data?.message === "string" ? data.message : "Zahtev nije uspeo.",
      response.status,
    );
  }

  return data as T;
}

function errorMessage(error: unknown) {
  if (error instanceof TypeError)
    return "Server nije dostupan. Pokušaj ponovo.";
  return error instanceof Error ? error.message : "Došlo je do greške.";
}

function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...previous, ...incoming])
    byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    api<{ user: User }>("/auth/me", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setUser(data.user);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (!(error instanceof ApiError && error.status === 401)) {
          setCheckError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });

    return () => controller.abort();
  }, [attempt]);

  const expire = useCallback(() => {
    setUser(null);
    setNotice("Sesija je istekla. Prijavi se ponovo.");
  }, []);

  if (checking) {
    return (
      <main className={styles.authContainer}>
        <p role="status">Provera sesije…</p>
      </main>
    );
  }

  if (checkError) {
    return (
      <main className={styles.authContainer}>
        <section className={styles.card}>
          <h1>Chat System</h1>
          <p className={styles.error} role="alert">
            {checkError}
          </p>
          <button
            className={styles.button}
            onClick={() => {
              setCheckError("");
              setChecking(true);
              setAttempt((current) => current + 1);
            }}
          >
            Pokušaj ponovo
          </button>
        </section>
      </main>
    );
  }

  return user ? (
    <Chat
      key={user.id}
      user={user}
      onExpired={expire}
      onLogout={() => {
        setUser(null);
        setNotice("");
      }}
    />
  ) : (
    <AuthForm
      notice={notice}
      onLogin={(nextUser) => {
        setNotice("");
        setUser(nextUser);
      }}
    />
  );
}

function AuthForm({
  notice,
  onLogin,
}: {
  notice: string;
  onLogin: (user: User) => void;
}) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");

    try {
      const data = await api<{ user: User }>(
        register ? "/auth/register" : "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            ...(register ? { username: form.get("username") } : {}),
            email: form.get("email"),
            password: form.get("password"),
          }),
        },
      );
      onLogin(data.user);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.authContainer}>
      <section className={styles.card}>
        <p className={styles.brand}>CHAT SYSTEM</p>
        <h1>{register ? "Napravi nalog" : "Prijavi se"}</h1>
        <p className={styles.muted}>
          Tvoji privatni razgovori na jednom mestu.
        </p>
        <form
          key={String(register)}
          className={styles.authForm}
          onSubmit={submit}
        >
          <fieldset disabled={busy} className={styles.fields}>
            {register && (
              <label className={styles.label}>
                Korisničko ime
                <input
                  name="username"
                  required
                  minLength={3}
                  maxLength={30}
                  pattern="[a-zA-Z0-9_]{3,30}"
                  autoComplete="username"
                />
                <small>3–30 slova, brojeva ili donjih crta.</small>
              </label>
            )}
            <label className={styles.label}>
              Email
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
              />
            </label>
            <label className={styles.label}>
              Lozinka
              <input
                name="password"
                type="password"
                required
                minLength={register ? 8 : 1}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
              />
              {register && <small>Najmanje 8 znakova.</small>}
            </label>
            {(error || notice) && (
              <p className={styles.error} role="alert">
                {error || notice}
              </p>
            )}
            <button className={styles.button} type="submit">
              {busy ? "Sačekaj…" : register ? "Registruj se" : "Prijavi se"}
            </button>
          </fieldset>
        </form>
        <button
          className={styles.textButton}
          disabled={busy}
          onClick={() => {
            setRegister((current) => !current);
            setError("");
          }}
        >
          {register
            ? "Već imaš nalog? Prijavi se"
            : "Nemaš nalog? Registruj se"}
        </button>
      </section>
    </main>
  );
}

function Chat({
  user,
  onExpired,
  onLogout,
}: {
  user: User;
  onExpired: () => void;
  onLogout: () => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [connection, setConnection] = useState<{
    socket: Socket;
    version: number;
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
      setConnection({ socket, version: ++version });
      setConnectionError("");
      void refresh(controller.signal);
    });
    socket.on("disconnect", () => {
      if (!controller.signal.aborted) setConnection(null);
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
            .timeout(10000)
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
  const other = selected?.members.find(
    (member) => member.user.id !== user.id,
  )?.user;

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Chat System</h1>
          <p className={styles.muted}>
            Prijavljen kao <strong>@{user.username}</strong>
          </p>
        </div>
        <button
          className={styles.secondary}
          onClick={logout}
          disabled={loggingOut}
        >
          {loggingOut ? "Odjava…" : "Odjavi se"}
        </button>
      </header>
      <p className={styles.connection} role="status">
        {connection ? "Povezan" : "Povezivanje…"}
      </p>
      {connectionError && (
        <p className={styles.error} role="alert">
          {connectionError}
        </p>
      )}
      {error && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button
            className={styles.textButton}
            onClick={() => void refresh(lifetime.current ?? undefined)}
          >
            Osveži razgovore
          </button>
        </div>
      )}
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <form onSubmit={create} className={styles.authForm}>
            <label className={styles.label} htmlFor="recipient">
              Novi privatni razgovor
            </label>
            <div className={styles.form}>
              <input
                id="recipient"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="Korisničko ime"
                required
                minLength={3}
                maxLength={30}
                disabled={creating || loggingOut}
              />
              <button
                className={styles.button}
                disabled={creating || loggingOut || !recipient.trim()}
              >
                {creating ? "…" : "Otvori"}
              </button>
            </div>
          </form>
          <h2 className={styles.sectionTitle}>Tvoji razgovori</h2>
          {loading ? (
            <p className={styles.muted} role="status">
              Učitavanje razgovora…
            </p>
          ) : (
            conversations.length === 0 && (
              <p className={styles.muted}>
                Još nema razgovora. Unesi korisničko ime osobe kojoj želiš da
                pišeš.
              </p>
            )
          )}
          <nav className={styles.conversations} aria-label="Privatni razgovori">
            {conversations.map((conversation) => {
              const person = conversation.members.find(
                (member) => member.user.id !== user.id,
              )?.user;
              return (
                <button
                  key={conversation.id}
                  className={`${styles.conversation} ${selectedId === conversation.id ? styles.selected : ""}`}
                  aria-pressed={selectedId === conversation.id}
                  disabled={loggingOut}
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <strong>{person?.username ?? "Razgovor"}</strong>
                  <span className={styles.preview}>
                    {conversation.messages?.[0]?.text ?? "Započni razgovor"}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>
        <section className={styles.chatPanel} aria-label="Aktivni razgovor">
          {selected && other ? (
            <>
              <h2 className={styles.chatTitle}>@{other.username}</h2>
              {connection && !loggingOut ? (
                <ConversationView
                  key={`${selected.id}:${connection.version}`}
                  conversationId={selected.id}
                  user={user}
                  socket={connection.socket}
                  onExpired={onExpired}
                  joinRoom={joinRoom}
                />
              ) : (
                <p className={styles.empty} role="status">
                  {loggingOut ? "Odjava…" : "Povezivanje sa serverom…"}
                </p>
              )}
            </>
          ) : (
            <p className={styles.empty}>Izaberi razgovor ili započni novi.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function ConversationView({
  conversationId,
  user,
  socket,
  onExpired,
  joinRoom,
}: {
  conversationId: number;
  user: User;
  socket: Socket;
  onExpired: () => void;
  joinRoom: (
    socket: Socket,
    id: number,
    signal: AbortSignal,
  ) => Promise<JoinResponse | undefined>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lifetime = useRef<AbortSignal | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

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

    async function open() {
      try {
        const response = await joinRoom(
          socket,
          conversationId,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (response?.error === SESSION_EXPIRED) {
          onExpired();
          return;
        }
        if (!response?.joined)
          throw new Error(response?.error ?? "Ulazak u razgovor nije uspeo.");
        const history = await api<ChatMessage[]>(
          `/conversations/${conversationId}/messages`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setMessages((previous) => mergeMessages(previous, history));
        setHasOlder(history.length === 100);
        setJoined(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) onExpired();
        else setError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void open();
    return () => {
      controller.abort();
      socket.off("new-message", receive);
    };
  }, [conversationId, socket, onExpired, joinRoom, attempt]);

  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [lastId]);

  async function older() {
    const signal = lifetime.current;
    if (!signal || signal.aborted || loadingOlder || !messages.length) return;
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
      sending ||
      !socket.connected ||
      !signal ||
      signal.aborted
    )
      return;
    setSending(true);
    setError("");
    try {
      const response: SendResponse = await socket
        .timeout(10000)
        .emitWithAck("send-message", {
          conversationId,
          clientMessageId: crypto.randomUUID(),
          text: body,
        });
      if (signal.aborted) return;
      if (response?.error === SESSION_EXPIRED) {
        onExpired();
        return;
      }
      if (!response?.success || !response.message)
        throw new Error(response?.error ?? "Slanje nije uspelo.");
      const message = response.message;
      setMessages((previous) => mergeMessages(previous, [message]));
      setText("");
    } catch (error) {
      if (!signal.aborted) setError(errorMessage(error));
    } finally {
      if (!signal.aborted) setSending(false);
    }
  }

  return (
    <>
      <div className={styles.list} aria-label="Poruke">
        {hasOlder && (
          <button
            className={styles.secondary}
            disabled={loadingOlder}
            onClick={older}
          >
            {loadingOlder ? "Učitavanje…" : "Učitaj starije poruke"}
          </button>
        )}
        {loading && (
          <p className={styles.muted} role="status">
            Učitavanje poruka…
          </p>
        )}
        {!loading && joined && !messages.length && (
          <p className={styles.muted}>Još nema poruka. Pošalji prvi pozdrav.</p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.row} ${message.senderId === user.id ? styles.mine : ""}`}
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
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!loading && !joined && (
        <button
          className={styles.secondary}
          onClick={() => {
            setLoading(true);
            setError("");
            setAttempt((current) => current + 1);
          }}
        >
          Pokušaj ponovo
        </button>
      )}
      <form onSubmit={send} className={styles.form}>
        <input
          aria-label="Poruka"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Napiši poruku…"
          maxLength={2000}
          disabled={!joined || sending}
        />
        <button
          className={styles.button}
          disabled={!joined || sending || !text.trim()}
        >
          {sending ? "Šaljem…" : "Pošalji"}
        </button>
      </form>
    </>
  );
}
