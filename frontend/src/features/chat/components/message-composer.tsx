import type { FormEvent } from "react";
import type { DeliveryStatus } from "../types";
import styles from "../chat.module.css";
import ui from "../../../styles/ui.module.css";

type Props = {
  text: string;
  delivery: DeliveryStatus;
  disabled: boolean;
  onTextChange: (value: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
};

export function MessageComposer({
  text,
  delivery,
  disabled,
  onTextChange,
  onSend,
}: Props) {
  const sending = delivery.state === "sending";
  return (
    <>
      {delivery.state !== "idle" && (
        <p
          className={
            delivery.state === "rejected" || delivery.state === "unconfirmed"
              ? ui.error
              : styles.deliveryStatus
          }
          role={
            delivery.state === "rejected" || delivery.state === "unconfirmed"
              ? "alert"
              : "status"
          }
          data-delivery-state={delivery.state}
        >
          {delivery.message}
        </p>
      )}
      <form onSubmit={onSend} className={ui.form}>
        <input
          aria-label="Poruka"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Napiši poruku…"
          maxLength={2000}
          disabled={disabled || sending}
        />
        <button
          className={ui.button}
          disabled={disabled || sending || !text.trim()}
        >
          {sending ? "Šaljem…" : "Pošalji"}
        </button>
      </form>
    </>
  );
}
