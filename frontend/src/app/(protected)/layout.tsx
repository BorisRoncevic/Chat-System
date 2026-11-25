import type { ReactNode } from "react";
import { SessionGate } from "../../features/auth/components/session-gate";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return <SessionGate access="authenticated">{children}</SessionGate>;
}
