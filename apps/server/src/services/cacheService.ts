import fs from "node:fs";
import path from "node:path";
import type { ProblemContext } from "@leetcode-assistant/shared";

interface CacheStore {
  problems: Record<string, ProblemContext>;
}

const CACHE_DIR = path.resolve(process.cwd(), "data");
const CACHE_PATH = path.join(CACHE_DIR, "problem-cache.json");

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

    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as CacheStore;
    Object.entries(parsed.problems ?? {}).forEach(([key, value]) => {
      this.memory.set(key, value);
    });
  }

  private saveToDisk(): void {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const payload: CacheStore = {
      problems: Object.fromEntries(this.memory.entries())
    };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), "utf8");
  }
}
