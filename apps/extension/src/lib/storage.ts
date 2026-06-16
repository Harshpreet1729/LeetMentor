import type { ChatMessage, UserPreferences } from "@leetcode-assistant/shared";
import { DEFAULT_LANGUAGE } from "@leetcode-assistant/shared";

const DEFAULT_PREFERENCES: UserPreferences = {
  language: DEFAULT_LANGUAGE,
  theme: "system",
  model: "llama-3.3-70b-versatile"
};

export async function getPreferences(): Promise<UserPreferences> {
  const result = await chrome.storage.local.get("preferences");
  return { ...DEFAULT_PREFERENCES, ...(result.preferences as Partial<UserPreferences> | undefined) };
}

export async function savePreferences(preferences: UserPreferences): Promise<void> {
  await chrome.storage.local.set({ preferences });
}

export async function getChatHistory(): Promise<ChatMessage[]> {
  const result = await chrome.storage.local.get("chatHistory");
  return (result.chatHistory as ChatMessage[] | undefined) ?? [];
}

export async function saveChatHistory(messages: ChatMessage[]): Promise<void> {
  await chrome.storage.local.set({ chatHistory: messages });
}

export async function clearChatHistory(): Promise<void> {
  await chrome.storage.local.remove("chatHistory");
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
