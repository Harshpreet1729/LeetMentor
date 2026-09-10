import { state, elements } from "./workspace.js?v=20260910-cleanup";
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInlineMarkdown(text) {
  const codeSpans = [];
  let html = String(text || "").replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE_SPAN_${codeSpans.length}@@`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });
  html = escapeHtml(html);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/@@CODE_SPAN_(\d+)@@/g, (_, index) => codeSpans[Number(index)] || "");
  return html;
}

function renderTechnicalInline(text) {
  const tokens = [];
  const source = String(text || "").replace(
    /(\[[a-zA-Z0-9_,\s-]+\]|\b[a-zA-Z_]\w*\[[^\]]+\]|\b[a-zA-Z]+_[a-zA-Z0-9_]+\b|\bn\s*-\s*1\b)/g,
    (match) => {
      const token = `@@TECH_TOKEN_${tokens.length}@@`;
      tokens.push(`<code>${escapeHtml(match)}</code>`);
      return token;
    }
  );

  return escapeHtml(source).replace(/@@TECH_TOKEN_(\d+)@@/g, (_, index) => tokens[Number(index)] || "");
}

function renderList(lines, ordered) {
  const tag = ordered ? "ol" : "ul";
  const items = lines.map((line) => {
    const content = ordered
      ? line.replace(/^\d+\.\s+/, "")
      : line.replace(/^[-*]\s+/, "");
    return `<li>${renderInlineMarkdown(content)}</li>`;
  });
  return `<${tag}>${items.join("")}</${tag}>`;
}

function normalizeAssistantText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/(### [^\n`]+?)\s+```/g, "$1\n\n```")
    .replace(/(### (?:Coding plan|Steps))\s+[-*]\s+/gi, "$1\n\n- ")
    .replace(/(### (?:Coding plan|Steps))\s+(\d+\.\s+)/gi, "$1\n\n$2")
    .replace(/(### [^\n]+?)\s+(?=\d+\.\s)/g, "$1\n\n")
    .replace(/(### [^\n]+?)\s+(?=[A-Z][a-z])/g, "$1\n\n")
    .replace(/^(#{2,4} [^\n]+)\n(?!\n)/gm, "$1\n\n")
    .replace(/```(\w+)?\s+/g, (_, language) => `\n\`\`\`${language || ""}\n`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderTextBlock(text) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((segment) => {
      const cleaned = segment.trim();
      if (!cleaned) {
        return "";
      }

      if (cleaned.startsWith("## ")) {
        return `<h2>${renderInlineMarkdown(cleaned.slice(3))}</h2>`;
      }
      if (cleaned.startsWith("### ")) {
        return `<h3>${renderInlineMarkdown(cleaned.slice(4))}</h3>`;
      }
      if (cleaned.startsWith("#### ")) {
        return `<h4>${renderInlineMarkdown(cleaned.slice(5))}</h4>`;
      }
      if (cleaned.startsWith("> ")) {
        return `<blockquote>${renderInlineMarkdown(cleaned.replace(/^>\s?/, ""))}</blockquote>`;
      }
      if (cleaned.startsWith("\\[") && cleaned.endsWith("\\]")) {
        return `<div class="math-block">${escapeHtml(cleaned)}</div>`;
      }

      const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        return renderList(lines, false);
      }
      if (lines.every((line) => /^\d+\.\s+/.test(line))) {
        return renderList(lines, true);
      }

      return `<p>${renderInlineMarkdown(cleaned).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

export function renderAssistantOutput(text) {
  const source = normalizeAssistantText(text);
  state.lastAssistantText = String(text || "");
  if (!source) {
    elements.assistantOutput.innerHTML = "<p>No answer yet.</p>";
    return;
  }

  const htmlParts = [];
  const codePattern = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codePattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      htmlParts.push(renderTextBlock(source.slice(lastIndex, match.index)));
    }
    const language = escapeHtml(match[1] || "");
    const code = escapeHtml(match[2].trim());
    htmlParts.push(`<pre><code class="language-${language}">${code}</code></pre>`);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < source.length) {
    htmlParts.push(renderTextBlock(source.slice(lastIndex)));
  }

  elements.assistantOutput.innerHTML = htmlParts.join("");
  elements.assistantOutput.scrollTop = 0;

  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([elements.assistantOutput]).catch(() => {});
  }
}

function renderMultilineText(text) {
  return escapeHtml(String(text || "")).replace(/\n/g, "<br>");
}

export function renderProblemExamples(exampleCards, exampleStrings) {
  const cards = Array.isArray(exampleCards) ? exampleCards : [];
  const examples = Array.isArray(exampleStrings) ? exampleStrings : [];

  if (!cards.length && !examples.length) {
    elements.problemExamples.innerHTML = '<p class="detail-empty">No examples available.</p>';
    return;
  }

  if (cards.length) {
    elements.problemExamples.innerHTML = cards
      .map((card, index) => {
        const parts = [];
        const title = escapeHtml(card.title || `Example ${index + 1}`);

        const labels = { input: "Input", output: "Output", explanation: "Explanation" };
        for (const [field, label] of Object.entries(labels)) {
          if (card[field]) {
            parts.push(
              `<div class="detail-item"><span class="detail-item__label">${label}</span><p>${renderMultilineText(card[field])}</p></div>`
            );
          }
        }
        if (Array.isArray(card.notes) && card.notes.length) {
          parts.push(
            `<div class="detail-item"><span class="detail-item__label">Notes</span><ul class="detail-list">${card.notes.map((note) => `<li>${renderMultilineText(note)}</li>`).join("")}</ul></div>`
          );
        }
        if (card.body) {
          parts.push(
            `<div class="detail-item"><span class="detail-item__label">Details</span><p>${renderMultilineText(card.body)}</p></div>`
          );
        }

        return `<article class="example-card"><h4 class="example-card__title">${title}</h4>${parts.join("")}</article>`;
      })
      .join("");
    return;
  }

  elements.problemExamples.innerHTML = examples
    .map((example, index) => `<article class="example-card"><h4 class="example-card__title">Example ${index + 1}</h4><p>${renderMultilineText(example)}</p></article>`)
    .join("");
}

export function renderProblemConstraints(constraints) {
  const items = Array.isArray(constraints) ? constraints.filter(Boolean) : [];

  if (!items.length) {
    elements.problemConstraints.innerHTML = '<p class="detail-empty">No constraints available.</p>';
    return;
  }

  elements.problemConstraints.innerHTML = `<ul class="constraint-list">${items
    .map((constraint) => `<li>${renderMultilineText(constraint)}</li>`)
    .join("")}</ul>`;
}

function problemPreviewText(problem) {
  const statement = String(problem?.statement || "").replace(/\s+/g, " ").trim();
  if (!statement) {
    return "Load a problem to see a concise summary here.";
  }
  return statement.length > 180 ? `${statement.slice(0, 180).trimEnd()}...` : statement;
}

export function renderProblemPreview(problem) {
  if (!elements.problemStatementPreview) {
    return;
  }
  elements.problemStatementPreview.innerHTML = renderTechnicalInline(problemPreviewText(problem));
}
