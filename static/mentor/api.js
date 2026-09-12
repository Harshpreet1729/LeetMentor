import { state, updateServerChip } from "./workspace.js?v=20260912-names";

const SERVER_WAKE_TIMEOUT_MS = 90000;
const SERVER_WAKE_RETRY_DELAY_MS = 3000;
export const SERVER_IDLE_THRESHOLD_MS = 4 * 60 * 1000;

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getCsrfToken() {
  const metaToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");
  if (metaToken && metaToken !== "NOTPROVIDED") {
    return metaToken;
  }

  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("csrftoken="));

  return cookie ? decodeURIComponent(cookie.split("=")[1]) : "";
}

function createRequestError(message, statusCode) {
  const error = new Error(message || "Request failed.");
  if (typeof statusCode === "number") {
    error.statusCode = statusCode;
  }
  return error;
}

export function isLeetCodeUnavailable(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.statusCode === 503 ||
    message.includes("could not reach leetcode") ||
    message.includes("leetcode request failed") ||
    message.includes("check your internet connection")
  );
}
export async function fetchJson(url, options, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...(options || {}), signal: controller.signal });
    const contentType = response.headers.get("content-type") || "";
    let data;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      const normalizedText = text.trim().toLowerCase();
      const isHtmlResponse =
        contentType.includes("text/html") ||
        normalizedText.startsWith("<!doctype") ||
        normalizedText.startsWith("<html");
      throw createRequestError(
        isHtmlResponse
          ? "The server returned a temporary error. Retrying shortly..."
          : text || "Request failed.",
        response.status
      );
    }

    if (!response.ok || !data.ok) {
      throw createRequestError(data.message || "Request failed.", response.status);
    }

    return data;
  } finally {
    window.clearTimeout(timer);
  }
}

function canRetryRequest(error) {
  if (!error) {
    return false;
  }

  if (error.name === "AbortError") {
    return true;
  }

  if (typeof error.statusCode === "number" && error.statusCode >= 500) {
    return true;
  }

  const message = String(error.message || "").toLowerCase();
  return [
    "waking up",
    "failed to fetch",
    "request failed",
    "timed out",
    "html error page",
    "service unavailable",
    "bad gateway",
    "gateway timeout"
  ].some((snippet) => message.includes(snippet));
}

async function waitForServer() {
  if (state.serverWakeTask) {
    return state.serverWakeTask;
  }

  state.serverWakeTask = (async () => {
    const startedAt = Date.now();
    updateServerChip("Waking server...", "warning");

    while (Date.now() - startedAt < SERVER_WAKE_TIMEOUT_MS) {
      try {
        await fetchJson("/api/health/", undefined, 12000);
        updateServerChip("Server ready", "success");
        state.lastWakeCheckAt = Date.now();
        return true;
      } catch (error) {
        updateServerChip("Still waking...", "warning");
        await delay(SERVER_WAKE_RETRY_DELAY_MS);
      }
    }

    updateServerChip("Server unreachable", "error");
    throw new Error("The server is still waking up. Please wait a few seconds and try again.");
  })();

  try {
    return await state.serverWakeTask;
  } finally {
    state.serverWakeTask = null;
  }
}

export async function withServerRetry(task, handlers = {}) {
  try {
    return await task();
  } catch (error) {
    if (!canRetryRequest(error)) {
      throw error;
    }

    if (typeof handlers.onWakeStart === "function") {
      handlers.onWakeStart(error);
    }

    await waitForServer();

    if (typeof handlers.onRetry === "function") {
      handlers.onRetry();
    }

    return task();
  }
}

export function wakeServer() {
  const now = Date.now();
  if (state.loading || state.serverWakeTask || now - state.lastWakeCheckAt < 30000) {
    return;
  }

  state.lastWakeCheckAt = now;
  updateServerChip("Checking server...", "warning");
  waitForServer().catch(() => {
    updateServerChip("Wake check failed", "error");
  });
}
export async function postJson(url, payload, timeoutMs = 25000) {
  return fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCsrfToken()
    },
    body: JSON.stringify(payload)
  }, timeoutMs);
}
