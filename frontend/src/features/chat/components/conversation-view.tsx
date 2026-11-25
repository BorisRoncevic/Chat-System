import { useConversation } from "../hooks/use-conversation";
import type { ConversationOptions } from "../types";
import { MessageList } from "./message-list";
import { MessageComposer } from "./message-composer";
import ui from "../../../styles/ui.module.css";

export function ConversationView(props: ConversationOptions) {
  const { user, connected } = props;
  const {
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
  } = useConversation(props);

  return (
    <>
      <MessageList
        messages={messages}
        userId={user.id}
        connected={connected}
        joined={joined}
        loading={loading}
        hasOlder={hasOlder}
        loadingOlder={loadingOlder}
        onLoadOlder={older}
      />
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}
      {!loading && !joined && connected && (
        <button className={ui.secondary} onClick={retryJoin}>
          Pokušaj ponovo
        </button>
      )}
      <MessageComposer
        text={text}
        delivery={delivery}
        disabled={!connected || !joined}
        onTextChange={changeText}
        onSend={send}
      />
    </>
  );
}
