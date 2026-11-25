import type { ChatMessage } from "../types";

export function mergeMessages(
  previous: ChatMessage[],
  incoming: ChatMessage[],
) {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...previous, ...incoming])
    byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}
