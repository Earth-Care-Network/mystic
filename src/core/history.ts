import type { ChatMessage } from "./providers";

/** The last `keep` messages, cut where the person spoke, so no tool result loses its call. */
export function trimHistory(history: ChatMessage[], keep = 200): ChatMessage[] {
  if (history.length <= keep) return history;
  const tail = history.slice(-keep);
  const first = tail.findIndex((m) => m.role === "user");
  return first === -1 ? [] : tail.slice(first);
}
