"use client";

import { createContext } from "react";
import type { ReactNode } from "react";
import { useSessionState } from "../hooks/use-session-state";

export const SessionContext = createContext<ReturnType<
  typeof useSessionState
> | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useSessionState();
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}
