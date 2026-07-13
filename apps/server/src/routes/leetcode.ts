import { Router } from "express";
import { LeetCodeService } from "../services/leetcodeService.js";

export function createLeetCodeRouter(leetcodeService: LeetCodeService): Router {
  const router = Router();

  router.get("/daily", async (_request, response) => {
    try {
      const problem = await leetcodeService.getDailyChallenge();
      response.json(problem);
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : "Failed to fetch daily challenge."
      });
    }
  });

  router.get("/problem/:identifier", async (request, response) => {
    try {
      const identifier = request.params.identifier.trim();
      if (!identifier || identifier.length > 500) {
        return response.status(400).json({ message: "Problem identifier must be between 1 and 500 characters." });
      }

      const problem = await leetcodeService.getProblem(identifier);
      response.json(problem);
    } catch (error) {
      response.status(404).json({
        message: error instanceof Error ? error.message : "Failed to fetch problem."
      });
    }
  });

  return router;
}
