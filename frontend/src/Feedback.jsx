function InlineText({ text }) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

// React escapes all text here. Provider HTML is never inserted into the page.
export default function Feedback({ answer }) {
  return answer.split("```").map((section, sectionIndex) => {
    if (sectionIndex % 2) {
      return <pre key={sectionIndex}>{section.replace(/^[a-zA-Z0-9+#-]*\n/, "").trimEnd()}</pre>;
    }
    return section.trim().split(/\n\s*\n/).map((block, blockIndex) => {
      if (!block) return null;
      const key = `${sectionIndex}-${blockIndex}`;
      const lines = block.split("\n");
      if (lines.length > 1 && lines.every(line => line.trim().startsWith("|"))) {
        const rows = lines.filter(line => !/^\s*\|[\s:|−-]+\|\s*$/.test(line));
        return <table key={key}><tbody>{rows.map((line, rowIndex) => (
          <tr key={rowIndex}>{line.trim().replace(/^\||\|$/g, "").split("|").map((value, columnIndex) => {
            const Cell = rowIndex === 0 ? "th" : "td";
            return <Cell key={columnIndex}><InlineText text={value.trim()} /></Cell>;
          })}</tr>
        ))}</tbody></table>;
      }
      const Tag = /^#{1,6} /.test(block) ? "h4" : "p";
      return <Tag key={key}><InlineText text={block.replace(/^#{1,6} /, "")} /></Tag>;
    });
  });
}
