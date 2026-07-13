import type { ChatMessage, UserPreferences } from "@leetcode-assistant/shared";
import { DEFAULT_LANGUAGE } from "@leetcode-assistant/shared";

const DEFAULT_PREFERENCES: UserPreferences = {
  language: DEFAULT_LANGUAGE,
  theme: "system",
  model: "llama-3.3-70b-versatile"
};

const CHAT_HISTORY_PREFIX = "chatHistory:";
const LEGACY_CHAT_HISTORY_KEY = "chatHistory";
const MAX_CHAT_MESSAGES = 100;

export async function getPreferences(): Promise<UserPreferences> {
  const result = await chrome.storage.local.get("preferences");
  return { ...DEFAULT_PREFERENCES, ...(result.preferences as Partial<UserPreferences> | undefined) };
}

export async function savePreferences(preferences: UserPreferences): Promise<void> {
  await chrome.storage.local.set({ preferences });
}

function chatHistoryKey(problemSlug?: string | null): string {
  return `${CHAT_HISTORY_PREFIX}${problemSlug || "global"}`;
}

export async function getChatHistory(problemSlug?: string | null): Promise<ChatMessage[]> {
  const key = chatHistoryKey(problemSlug);
  const result = await chrome.storage.local.get(key);
  const messages = result[key];
  return Array.isArray(messages) ? (messages as ChatMessage[]).slice(-MAX_CHAT_MESSAGES) : [];
}

export async function saveChatHistory(messages: ChatMessage[], problemSlug?: string | null): Promise<void> {
  const key = chatHistoryKey(problemSlug);
  await chrome.storage.local.set({ [key]: messages.slice(-MAX_CHAT_MESSAGES) });
}

export async function clearChatHistory(problemSlug?: string | null): Promise<void> {
  if (problemSlug !== undefined) {
    await chrome.storage.local.remove(chatHistoryKey(problemSlug));
    return;
  }

  const storedItems = await chrome.storage.local.get(null);
  const historyKeys = Object.keys(storedItems).filter(
    (key) => key === LEGACY_CHAT_HISTORY_KEY || key.startsWith(CHAT_HISTORY_PREFIX)
  );
  if (historyKeys.length) {
    await chrome.storage.local.remove(historyKeys);
  }
}

function draftKey(problemSlug?: string | null): string {
  return `codeDraft:${problemSlug || "global"}`;
}

export async function getCodeDraft(problemSlug?: string | null): Promise<string> {
  const key = draftKey(problemSlug);
  const result = await chrome.storage.local.get(key);
  return (result[key] as string | undefined) ?? "";
}

export async function saveCodeDraft(code: string, problemSlug?: string | null): Promise<void> {
  const key = draftKey(problemSlug);
  await chrome.storage.local.set({ [key]: code });
}
