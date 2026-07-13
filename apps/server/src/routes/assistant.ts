import { Router, type RequestHandler } from "express";
import { AIService } from "../services/aiService.js";
import { parseAssistantRequest } from "../validation/assistantRequest.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_MAX_CLIENTS = 10_000;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function createAssistantRateLimiter(): RequestHandler {
  const clients = new Map<string, RateLimitEntry>();
  let nextCleanupAt = 0;

  return (request, response, next) => {
    const now = Date.now();
    if (now >= nextCleanupAt) {
      for (const [key, entry] of clients) {
        if (entry.resetAt <= now) {
          clients.delete(key);
        }
      }
      nextCleanupAt = now + RATE_LIMIT_WINDOW_MS;
    }

    const clientKey = request.ip || request.socket.remoteAddress || "unknown";
    let entry = clients.get(clientKey);
    if (!entry || entry.resetAt <= now) {
      if (!clients.has(clientKey) && clients.size >= RATE_LIMIT_MAX_CLIENTS) {
        const oldestKey = clients.keys().next().value as string | undefined;
        if (oldestKey) {
          clients.delete(oldestKey);
        }
      }
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      clients.set(clientKey, entry);
    }

    response.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
    response.setHeader("X-RateLimit-Remaining", Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count));
    response.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1_000));

    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
      response.setHeader("Retry-After", Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)));
      response.status(429).json({ message: "Too many assistant requests. Please wait a moment and try again." });
      return;
    }

    entry.count += 1;
    response.setHeader("X-RateLimit-Remaining", RATE_LIMIT_MAX_REQUESTS - entry.count);
    next();
  };
}

export function createAssistantRouter(aiService: AIService): Router {
  const router = Router();
  const rateLimit = createAssistantRateLimiter();

  router.post("/chat", rateLimit, async (request, response) => {
    try {
      const parsed = parseAssistantRequest(request.body);
      if (!parsed.ok) {
        return response.status(400).json({ message: parsed.message });
      }

      const result = await aiService.generateAssistantResponse(parsed.value);
      return response.json(result);
    } catch (error) {
      console.error("Assistant request failed", error);
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return response.status(timedOut ? 504 : 502).json({
        message: timedOut
          ? "The assistant provider took too long to respond. Please try again."
          : "The assistant service is temporarily unavailable. Please try again."
      });
    }
  });

  return router;
}
