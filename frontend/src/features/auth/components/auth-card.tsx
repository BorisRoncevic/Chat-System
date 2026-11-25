import Link from "next/link";
import type { ReactNode } from "react";
import styles from "../auth.module.css";
import ui from "../../../styles/ui.module.css";

export function AuthCard({
  title,
  href,
  linkText,
  busy,
  children,
}: {
  title: string;
  href: "/login" | "/register";
  linkText: string;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <main className={styles.authContainer}>
      <section className={styles.card}>
        <p className={styles.brand}>CHAT SYSTEM</p>
        <h1>{title}</h1>
        <p className={ui.muted}>Tvoji privatni razgovori na jednom mestu.</p>
        {children}
        <Link
          href={href}
          className={ui.textButton}
          aria-disabled={busy}
          onClick={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          {linkText}
        </Link>
      </section>
    </main>
  );
}
