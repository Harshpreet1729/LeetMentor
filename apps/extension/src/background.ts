const API_BASE_URL = "http://localhost:4000/api";

interface ApiProxyMessage {
  type: "leetcode-assistant:api-request";
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("LeetCode Student-Friendly AI Assistant installed");
});

chrome.runtime.onMessage.addListener((message: ApiProxyMessage, _sender, sendResponse) => {
  if (message.type !== "leetcode-assistant:api-request") {
    return;
  }

  void (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}${message.path}`, {
        method: message.method ?? "GET",
        headers: {
          "Content-Type": "application/json"
        },
        body: message.body ? JSON.stringify(message.body) : undefined
      });

      const text = await response.text();
      const data = text ? (JSON.parse(text) as unknown) : null;

      sendResponse({
        ok: response.ok,
        status: response.status,
        data
      });
    } catch (error) {
      sendResponse({
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : "Network error"
      });
    }
  })();

  return true;
});
