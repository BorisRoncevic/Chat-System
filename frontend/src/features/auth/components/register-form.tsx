"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "../../../lib/api";
import { useSession } from "../hooks/use-session";
import type { User } from "../types";
import { AuthCard } from "./auth-card";
import styles from "../auth.module.css";
import ui from "../../../styles/ui.module.css";

export function RegisterForm() {
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
      const data = await api<{ user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
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
      title="Napravi nalog"
      href="/login"
      linkText="Već imaš nalog? Prijavi se"
      busy={busy}
    >
      <form className={ui.authForm} onSubmit={submit}>
        <fieldset disabled={busy} className={styles.fields}>
          <label className={ui.label}>
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
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
            />
            <small>Najmanje 8 znakova.</small>
          </label>
          {(error || notice) && (
            <p className={ui.error} role="alert">
              {error || notice}
            </p>
          )}
          <button className={ui.button} type="submit">
            {busy ? "Sačekaj…" : "Registruj se"}
          </button>
        </fieldset>
      </form>
    </AuthCard>
  );
}
