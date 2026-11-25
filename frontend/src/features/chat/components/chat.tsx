import { useChat } from "../hooks/use-chat";
import type { ChatProps } from "../types";
import { ConversationSidebar } from "./conversation-sidebar";
import { ConversationView } from "./conversation-view";
import styles from "../chat.module.css";
import ui from "../../../styles/ui.module.css";

export function Chat({ user, onExpired, onLogout }: ChatProps) {
  const {
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
  } = useChat({ onExpired, onLogout });

  const other = selected?.members.find(
    (member) => member.user.id !== user.id,
  )?.user;

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Chat System</h1>
          <p className={ui.muted}>
            Prijavljen kao <strong>@{user.username}</strong>
          </p>
        </div>
        <button className={ui.secondary} onClick={logout} disabled={loggingOut}>
          {loggingOut ? "Odjava…" : "Odjavi se"}
        </button>
      </header>
      <p className={styles.connection} role="status">
        {connection?.connected ? "Povezan" : "Povezivanje…"}
      </p>
      {connectionError && (
        <p className={ui.error} role="alert">
          {connectionError}
        </p>
      )}
      {error && (
        <div className={ui.error} role="alert">
          <p>{error}</p>
          <button className={ui.textButton} onClick={refreshConversations}>
            Osveži razgovore
          </button>
        </div>
      )}
      <div className={styles.workspace}>
        <ConversationSidebar
          userId={user.id}
          conversations={conversations}
          selectedId={selectedId}
          loading={loading}
          recipient={recipient}
          creating={creating}
          loggingOut={loggingOut}
          onCreate={create}
          onRecipientChange={setRecipient}
          onSelect={setSelectedId}
        />
        <section className={styles.chatPanel} aria-label="Aktivni razgovor">
          {selected && other ? (
            <>
              <h2 className={styles.chatTitle}>@{other.username}</h2>
              {connection && !loggingOut ? (
                <ConversationView
                  key={selected.id}
                  conversationId={selected.id}
                  user={user}
                  socket={connection.socket}
                  connected={connection.connected}
                  connectionVersion={connection.version}
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
