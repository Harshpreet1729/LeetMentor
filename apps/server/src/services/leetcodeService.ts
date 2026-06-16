import type { ProblemContext } from "@leetcode-assistant/shared";
import { CacheService } from "./cacheService.js";

const DEFAULT_GRAPHQL_URL = "https://leetcode.com/graphql";

const DAILY_QUERY = `
  query questionOfToday {
    activeDailyCodingChallengeQuestion {
      date
      userStatus
      link
      question {
        questionFrontendId
        title
        titleSlug
        difficulty
        content
        topicTags {
          name
        }
        stats
        exampleTestcases
        hints
      }
    }
  }
`;

const PROBLEM_QUERY = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionFrontendId
      title
      titleSlug
      difficulty
      content
      topicTags {
        name
      }
      stats
      exampleTestcases
      hints
    }
  }
`;

const SEARCH_QUERY = `
  query problemsetQuestionList($search: String!) {
    problemsetQuestionList(
      categorySlug: ""
      limit: 10
      skip: 0
      filters: { searchKeywords: $search }
    ) {
      questions {
        questionFrontendId
        title
        titleSlug
      }
    }
  }
`;

const ALL_PROBLEMS_ENDPOINT = "https://leetcode.com/api/problems/all/";

interface DailyResponse {
  data?: {
    activeDailyCodingChallengeQuestion?: {
      link: string;
      question: LeetCodeQuestion;
    };
  };
}

interface ProblemResponse {
  data?: {
    question?: LeetCodeQuestion | null;
  };
}

interface SearchResponse {
  data?: {
    problemsetQuestionList?: {
      questions?: Array<{
        questionFrontendId: string;
        title: string;
        titleSlug: string;
      }>;
    };
  };
}

interface LeetCodeQuestion {
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  content: string;
  topicTags: Array<{ name: string }>;
  stats?: string;
  exampleTestcases?: string;
}

interface AllProblemsResponse {
  stat_status_pairs?: Array<{
    stat: {
      frontend_question_id: number;
      question__title: string;
      question__title_slug: string;
    };
  }>;
}

export class LeetCodeService {
  private problemIndexCache: Array<{ frontendId: string; title: string; titleSlug: string }> | null = null;
  private problemIndexFetchedAt = 0;

  constructor(private readonly cacheService: CacheService) {}

  async getDailyChallenge(): Promise<ProblemContext> {
    const response = await this.graphqlRequest<DailyResponse>(DAILY_QUERY, {});
    const daily = response.data?.activeDailyCodingChallengeQuestion;

    if (!daily?.question) {
      throw new Error("Unable to fetch today's daily challenge from LeetCode.");
    }

    const problem = this.mapQuestion(daily.question, daily.link);
    this.cacheProblem(problem);
    return problem;
  }

  async getProblem(identifier: string): Promise<ProblemContext> {
    const normalizedIdentifier = identifier.trim();
    const cached = this.cacheService.get(normalizedIdentifier);
    if (cached) {
      return cached;
    }

    const slug = await this.resolveSlug(normalizedIdentifier);
    const cachedBySlug = this.cacheService.get(slug);
    if (cachedBySlug) {
      return cachedBySlug;
    }

    const response = await this.graphqlRequest<ProblemResponse>(PROBLEM_QUERY, { titleSlug: slug });
    const question = response.data?.question;

    if (!question) {
      throw new Error("Problem not found. Please check the problem number, title, or URL.");
    }

    const problem = this.mapQuestion(question, `/problems/${question.titleSlug}/`);
    this.cacheProblem(problem);
    return problem;
  }

  private async resolveSlug(identifier: string): Promise<string> {
    if (identifier.startsWith("http")) {
      const url = new URL(identifier);
      const parts = url.pathname.split("/").filter(Boolean);
      const problemsIndex = parts.indexOf("problems");
      if (problemsIndex >= 0 && parts[problemsIndex + 1]) {
        return parts[problemsIndex + 1];
      }
    }

    if (/^[a-z0-9-]+$/i.test(identifier) && !/^\d+$/.test(identifier)) {
      return identifier.toLowerCase();
    }

    if (/^\d+$/.test(identifier)) {
      const indexedSlug = await this.lookupSlugFromProblemIndex(identifier);
      if (indexedSlug) {
        return indexedSlug;
      }

      const resolved = await this.searchSlug(identifier);
      if (resolved) {
        return resolved;
      }
      throw new Error("Problem number lookup failed. Try the title, slug, URL, or paste the statement.");
    }

    const normalizedTitleSlug = identifier
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");

    const indexedSlug = await this.lookupSlugFromProblemIndex(identifier);
    if (indexedSlug) {
      return indexedSlug;
    }

    const resolved = await this.searchSlug(identifier);
    return resolved ?? normalizedTitleSlug;
  }

  private async lookupSlugFromProblemIndex(identifier: string): Promise<string | null> {
    const normalized = identifier.trim().toLowerCase();
    const index = await this.getProblemIndex();
    const exact = index.find((entry) => {
      const normalizedTitle = entry.title.toLowerCase();
      return (
        entry.frontendId === normalized ||
        entry.titleSlug.toLowerCase() === normalized ||
        normalizedTitle === normalized ||
        normalizedTitle.replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-") === normalized
      );
    });

    return exact?.titleSlug ?? null;
  }

  private async getProblemIndex(): Promise<Array<{ frontendId: string; title: string; titleSlug: string }>> {
    const now = Date.now();
    if (this.problemIndexCache && now - this.problemIndexFetchedAt < 1000 * 60 * 60 * 12) {
      return this.problemIndexCache;
    }

    try {
      const response = await fetch(ALL_PROBLEMS_ENDPOINT, {
        headers: {
          Referer: "https://leetcode.com/problemset/",
          Origin: "https://leetcode.com"
        }
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as AllProblemsResponse;
      this.problemIndexCache =
        data.stat_status_pairs?.map((entry) => ({
          frontendId: String(entry.stat.frontend_question_id),
          title: entry.stat.question__title,
          titleSlug: entry.stat.question__title_slug
        })) ?? [];
      this.problemIndexFetchedAt = now;
      return this.problemIndexCache;
    } catch {
      return [];
    }
  }

  private async searchSlug(identifier: string): Promise<string | null> {
    const response = await this.graphqlRequest<SearchResponse>(SEARCH_QUERY, { search: identifier });
    const questions = response.data?.problemsetQuestionList?.questions ?? [];
    const normalized = identifier.trim().toLowerCase();

    const exactMatch = questions.find((question) => {
      return (
        question.questionFrontendId.toLowerCase() === normalized ||
        question.title.toLowerCase() === normalized ||
        question.titleSlug.toLowerCase() === normalized
      );
    });

    return exactMatch?.titleSlug ?? questions[0]?.titleSlug ?? null;
  }

  private mapQuestion(question: LeetCodeQuestion, link: string): ProblemContext {
    const stats = question.stats ? JSON.parse(question.stats) : undefined;
    const { statement, examples, constraints } = this.extractContentSections(question.content ?? "");

    return {
      title: question.title,
      titleSlug: question.titleSlug,
      questionFrontendId: question.questionFrontendId,
      difficulty: question.difficulty,
      tags: question.topicTags.map((tag) => tag.name),
      link: link.startsWith("http") ? link : `https://leetcode.com${link}`,
      statement,
      examples,
      constraints,
      acceptanceRate: stats?.acRate ? Number.parseFloat(stats.acRate) : undefined
    };
  }

  private extractContentSections(content: string): {
    statement: string;
    examples: string[];
    constraints: string[];
  } {
    const plainText = content
      .replace(/<pre>/g, "\n")
      .replace(/<\/pre>/g, "\n")
      .replace(/<li>/g, "- ")
      .replace(/<\/li>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{2,}/g, "\n\n")
      .trim();

    const parts = plainText.split(/Example \d+:/i);
    const statement = parts[0]?.trim() ?? plainText;

    const examples = Array.from(plainText.matchAll(/Example\s+\d+:\s*([\s\S]*?)(?=Example\s+\d+:|Constraints:|$)/gi)).map(
      (match) => match[1].trim()
    );

    const constraintsMatch = plainText.match(/Constraints:\s*([\s\S]*)$/i);
    const constraints = constraintsMatch
      ? constraintsMatch[1]
          .split(/\n|-/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [];

    return { statement, examples, constraints };
  }

  private cacheProblem(problem: ProblemContext): void {
    const identifiers = [
      problem.titleSlug,
      problem.questionFrontendId,
      problem.title,
      `https://leetcode.com/problems/${problem.titleSlug}/`
    ];
    this.cacheService.set(identifiers, problem);
  }

  private async graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(process.env.LEETCODE_GRAPHQL_URL ?? DEFAULT_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://leetcode.com",
        Origin: "https://leetcode.com"
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`LeetCode request failed with status ${response.status}.`);
    }

    return (await response.json()) as T;
  }
}
