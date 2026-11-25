import type { ReactNode } from "react";
import { SessionGate } from "../../features/auth/components/session-gate";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <SessionGate access="guest">{children}</SessionGate>;
}
