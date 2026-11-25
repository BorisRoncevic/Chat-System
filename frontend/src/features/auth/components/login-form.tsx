"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "../../../lib/api";
import { useSession } from "../hooks/use-session";
import type { User } from "../types";
import { AuthCard } from "./auth-card";
import styles from "../auth.module.css";
import ui from "../../../styles/ui.module.css";

export function LoginForm() {
  const { login, notice } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const data = await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      login(data.user);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Prijavi se"
      href="/register"
      linkText="Nemaš nalog? Registruj se"
      busy={busy}
    >
      <form className={ui.authForm} onSubmit={submit}>
        <fieldset disabled={busy} className={styles.fields}>
          <label className={ui.label}>
            Email
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
            />
          </label>
          <label className={ui.label}>
            Lozinka
            <input
              name="password"
              type="password"
              required
              minLength={1}
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          {(error || notice) && (
            <p className={ui.error} role="alert">
              {error || notice}
            </p>
          )}
          <button className={ui.button} type="submit">
            {busy ? "Sačekaj…" : "Prijavi se"}
          </button>
        </fieldset>
      </form>
    </AuthCard>
  );
}
