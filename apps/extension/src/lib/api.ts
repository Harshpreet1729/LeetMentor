import type { AssistantRequest, AssistantResponse, ProblemContext } from "@leetcode-assistant/shared";
import { API_BASE_URL } from "@leetcode-assistant/shared";

interface ProxyResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function extensionRequest<T>(path: string, options?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    const response = (await chrome.runtime.sendMessage({
      type: "leetcode-assistant:api-request",
      path,
      method: options?.method ?? "GET",
      body: options?.body
    })) as ProxyResponse<T>;

    if (!response?.ok) {
      const message =
        typeof response?.data === "object" && response?.data && "message" in response.data
          ? String((response.data as { message?: string }).message)
          : response?.error || "Backend not reachable. Make sure `npm.cmd run dev:server` is running on localhost:4000.";
      throw new Error(message);
    }

    return response.data as T;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      "Content-Type": "application/json"
    },
    body: options?.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(error.message ?? "Request failed.");
  }

  return (await response.json()) as T;
}

export async function fetchDailyChallenge(): Promise<ProblemContext> {
  return extensionRequest<ProblemContext>("/leetcode/daily");
}

export async function fetchProblem(identifier: string): Promise<ProblemContext> {
  return extensionRequest<ProblemContext>(`/leetcode/problem/${encodeURIComponent(identifier)}`);
}

export async function askAssistant(payload: AssistantRequest): Promise<AssistantResponse> {
  return extensionRequest<AssistantResponse>("/assistant/chat", {
    method: "POST",
    body: payload
  });
}

export function humanizeApiError(error: unknown, fallback: string): Error {
  const message = error instanceof Error ? error.message : fallback;
  if (message.includes("Backend not reachable")) {
    return new Error("Backend not reachable. Start `npm.cmd run dev:server` and try again.");
  }
  if (message.includes("Problem number lookup failed")) {
    return new Error("I could not resolve that problem number yet. Try the slug, title, or retry after the server refreshes its LeetCode index.");
  }
  if (message.includes("status 400")) {
    return new Error("LeetCode rejected that lookup request. Try the title slug or full title, or retry once.");
  }
  return new Error(message || fallback);
}
