import { useContext } from "react";
import { SessionContext } from "../components/session-provider";

export function useSession() {
  const session = useContext(SessionContext);
  if (!session)
    throw new Error("useSession must be used within SessionProvider");
  return session;
}
