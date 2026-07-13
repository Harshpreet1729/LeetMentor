import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { CacheService } from "./services/cacheService.js";
import { LeetCodeService } from "./services/leetcodeService.js";
import { AIService } from "./services/aiService.js";
import { createLeetCodeRouter } from "./routes/leetcode.js";
import { createAssistantRouter } from "./routes/assistant.js";

const app = express();
app.disable("x-powered-by");
const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const host = process.env.HOST?.trim() || "127.0.0.1";

const cacheService = new CacheService();
const leetcodeService = new LeetCodeService(cacheService);
const aiService = new AIService();

const configuredOrigins = new Set(
  (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  if (/^chrome-extension:\/\/[a-p]{32}$/i.test(origin)) {
    return true;
  }

  if (configuredOrigins.has(origin)) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    }
  })
);
app.use(express.json({ limit: "512kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.use("/api/leetcode", createLeetCodeRouter(leetcodeService));
app.use("/api/assistant", createAssistantRouter(aiService));

const jsonErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : undefined;
  if (error instanceof SyntaxError && status === 400) {
    response.status(400).json({ message: "Request body must contain valid JSON." });
    return;
  }

  if (status === 413) {
    response.status(413).json({ message: "Request body is too large." });
    return;
  }

  next(error);
};

app.use(jsonErrorHandler);

const unhandledErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error("Unhandled server error", error);
  response.status(500).json({ message: "An unexpected server error occurred." });
};

app.use(unhandledErrorHandler);

app.listen(port, host, () => {
  console.log(`LeetCode assistant server running on http://${host}:${port}`);
});
