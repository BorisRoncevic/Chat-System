import { useCallback, useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "../../../lib/api";
import type { User } from "../types";

export function useSessionState() {
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

  function retry() {
    setCheckError("");
    setChecking(true);
    setAttempt((current) => current + 1);
  }

  function login(nextUser: User) {
    setNotice("");
    setUser(nextUser);
  }

  function logout() {
    setUser(null);
    setNotice("");
  }

  return { user, checking, checkError, notice, expire, retry, login, logout };
}
