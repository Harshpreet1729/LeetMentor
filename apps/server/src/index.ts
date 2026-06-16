import "dotenv/config";
import express from "express";
import cors from "cors";
import { CacheService } from "./services/cacheService.js";
import { LeetCodeService } from "./services/leetcodeService.js";
import { AIService } from "./services/aiService.js";
import { createLeetCodeRouter } from "./routes/leetcode.js";
import { createAssistantRouter } from "./routes/assistant.js";

const app = express();
const port = Number.parseInt(process.env.PORT ?? "4000", 10);

const cacheService = new CacheService();
const leetcodeService = new LeetCodeService(cacheService);
const aiService = new AIService();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN, "http://localhost:5173"] : true
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.use("/api/leetcode", createLeetCodeRouter(leetcodeService));
app.use("/api/assistant", createAssistantRouter(aiService));

app.listen(port, () => {
  console.log(`LeetCode assistant server running on http://localhost:${port}`);
});
