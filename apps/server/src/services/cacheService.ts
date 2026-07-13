import fs from "node:fs";
import path from "node:path";
import type { ProblemContext } from "@leetcode-assistant/shared";

interface CacheStore {
  problems: Record<string, ProblemContext>;
}

const CACHE_DIR = path.resolve(process.cwd(), "data");
const CACHE_PATH = path.join(CACHE_DIR, "problem-cache.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProblemContext(value: unknown): value is ProblemContext {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.titleSlug === "string" &&
    typeof value.questionFrontendId === "string" &&
    typeof value.difficulty === "string" &&
    typeof value.link === "string" &&
    typeof value.statement === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    Array.isArray(value.examples) &&
    value.examples.every((example) => typeof example === "string") &&
    Array.isArray(value.constraints) &&
    value.constraints.every((constraint) => typeof constraint === "string")
  );
}

export class CacheService {
  private memory = new Map<string, ProblemContext>();

  constructor() {
    this.loadFromDisk();
  }

  get(identifier: string): ProblemContext | null {
    return this.memory.get(identifier.toLowerCase()) ?? null;
  }

  set(identifiers: string[], problem: ProblemContext): void {
    identifiers.forEach((identifier) => {
      this.memory.set(identifier.toLowerCase(), problem);
    });
    this.saveToDisk();
  }

  clear(): void {
    this.memory.clear();
    this.saveToDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(CACHE_PATH)) {
      return;
    }

    try {
      const raw = fs.readFileSync(CACHE_PATH, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || !isRecord(parsed.problems)) {
        throw new Error("Cache data has an invalid shape.");
      }

      Object.entries(parsed.problems).forEach(([key, value]) => {
        if (isProblemContext(value)) {
          this.memory.set(key.toLowerCase(), value);
        }
      });
    } catch (error) {
      console.warn("Ignoring unreadable problem cache; it will be rebuilt on demand.", error instanceof Error ? error.message : error);
      this.memory.clear();
    }
  }

  private saveToDisk(): void {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const payload: CacheStore = {
        problems: Object.fromEntries(this.memory.entries())
      };
      fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), "utf8");
    } catch (error) {
      console.warn("Unable to persist problem cache; continuing with the in-memory cache.", error instanceof Error ? error.message : error);
    }
  }
}
