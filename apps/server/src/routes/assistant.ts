import { Router } from "express";
import type { AssistantRequest } from "@leetcode-assistant/shared";
import { AIService } from "../services/aiService.js";

export function createAssistantRouter(aiService: AIService): Router {
  const router = Router();

  router.post("/chat", async (request, response) => {
    try {
      const body = request.body as AssistantRequest;

      if (!body.mode) {
        return response.status(400).json({ message: "Mode is required." });
      }

      const result = await aiService.generateAssistantResponse(body);
      return response.json(result);
    } catch (error) {
      return response.status(500).json({
        message: error instanceof Error ? error.message : "Failed to generate assistant response."
      });
    }
  });

  return router;
}
