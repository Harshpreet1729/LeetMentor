import type { ProblemContext } from "@leetcode-assistant/shared";

interface ProblemCardProps {
  problem: ProblemContext | null;
}

export function ProblemCard({ problem }: ProblemCardProps) {
  if (!problem) {
    return (
      <div className="assistant-card p-4 text-sm text-slate-400">
        No LeetCode problem detected yet. Open a problem page or load one by number, slug, title, or URL.
      </div>
    );
  }

  return (
    <div className="assistant-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="assistant-section-label">Current Problem</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-50">
            {problem.questionFrontendId ? `${problem.questionFrontendId}. ` : ""}
            {problem.title}
          </h2>
          <a className="mt-3 inline-block text-sm text-emerald-300 underline decoration-emerald-500/40 underline-offset-4" href={problem.link} target="_blank" rel="noreferrer">
            Open on LeetCode
          </a>
        </div>
        <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
          {problem.difficulty}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {problem.tags.map((tag) => (
          <span key={tag} className="rounded-full border border-white/8 bg-white/[0.05] px-2.5 py-1 text-xs text-slate-200">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
