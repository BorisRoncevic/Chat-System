"use client";

import { useSession } from "../features/auth/hooks/use-session";
import { Chat } from "../features/chat/components/chat";

export function ChatApp() {
  const { user, expire, logout } = useSession();
  if (!user) return null;
  return (
    <Chat key={user.id} user={user} onExpired={expire} onLogout={logout} />
  );
}
