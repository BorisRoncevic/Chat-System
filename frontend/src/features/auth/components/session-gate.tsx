"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "../hooks/use-session";
import styles from "../auth.module.css";
import ui from "../../../styles/ui.module.css";

export function SessionGate({
  access,
  children,
}: {
  access: "authenticated" | "guest";
  children: ReactNode;
}) {
  const { user, checking, checkError, retry } = useSession();
  const router = useRouter();
  const destination =
    access === "authenticated" ? (!user ? "/login" : null) : user ? "/" : null;

  useEffect(() => {
    if (!checking && !checkError && destination) router.replace(destination);
  }, [checking, checkError, destination, router]);

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
          <p className={ui.error} role="alert">
            {checkError}
          </p>
          <button className={ui.button} onClick={retry}>
            Pokušaj ponovo
          </button>
        </section>
      </main>
    );
  }
  if (destination) {
    return (
      <main className={styles.authContainer}>
        <p role="status">Preusmeravanje…</p>
      </main>
    );
  }
  return children;
}
