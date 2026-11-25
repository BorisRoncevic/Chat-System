import type { FormEvent } from "react";
import type { Conversation } from "../types";
import styles from "../chat.module.css";
import ui from "../../../styles/ui.module.css";

type Props = {
  userId: string;
  conversations: Conversation[];
  selectedId: number | null;
  loading: boolean;
  recipient: string;
  creating: boolean;
  loggingOut: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onRecipientChange: (value: string) => void;
  onSelect: (id: number) => void;
};

export function ConversationSidebar({
  userId,
  conversations,
  selectedId,
  loading,
  recipient,
  creating,
  loggingOut,
  onCreate,
  onRecipientChange,
  onSelect,
}: Props) {
  return (
    <aside className={styles.sidebar}>
      <form onSubmit={onCreate} className={ui.authForm}>
        <label className={ui.label} htmlFor="recipient">
          Novi privatni razgovor
        </label>
        <div className={ui.form}>
          <input
            id="recipient"
            value={recipient}
            onChange={(event) => onRecipientChange(event.target.value)}
            placeholder="Korisničko ime"
            required
            minLength={3}
            maxLength={30}
            disabled={creating || loggingOut}
          />
          <button
            className={ui.button}
            disabled={creating || loggingOut || !recipient.trim()}
          >
            {creating ? "…" : "Otvori"}
          </button>
        </div>
      </form>
      <h2 className={styles.sectionTitle}>Tvoji razgovori</h2>
      {loading ? (
        <p className={ui.muted} role="status">
          Učitavanje razgovora…
        </p>
      ) : (
        conversations.length === 0 && (
          <p className={ui.muted}>
            Još nema razgovora. Unesi korisničko ime osobe kojoj želiš da pišeš.
          </p>
        )
      )}
      <nav className={styles.conversations} aria-label="Privatni razgovori">
        {conversations.map((conversation) => {
          const person = conversation.members.find(
            (member) => member.user.id !== userId,
          )?.user;
          return (
            <button
              key={conversation.id}
              className={`${styles.conversation} ${selectedId === conversation.id ? styles.selected : ""}`}
              aria-pressed={selectedId === conversation.id}
              disabled={loggingOut}
              onClick={() => onSelect(conversation.id)}
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
  );
}
