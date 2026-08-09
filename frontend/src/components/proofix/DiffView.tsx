/**
 * Unified-diff renderer.
 *
 * The diff is the product — everything upstream exists to produce it — and it
 * was reachable only as two filenames on the patch card. `/runs/{id}/patch`
 * has served both sides of every file all along.
 *
 * Deliberately no syntax highlighter. `shiki` was removed from this project
 * once already; re-adding ~2 MB to colour keywords would buy less than the
 * add/remove colouring below, which is the distinction a reviewer actually
 * reads. Line classification is the whole parser, and it is a switch on the
 * first character because that *is* the unified-diff format.
 */

export type DiffLineKind = "add" | "del" | "hunk" | "file" | "meta" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based line number in the original file; null on added lines. */
  oldNumber: number | null;
  /** 1-based line number in the patched file; null on removed lines. */
  newNumber: number | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a unified diff into displayable lines with real line numbers.
 *
 * Numbers come from the hunk headers and advance per side, so they are the
 * file's own numbering rather than an index into the diff. A reviewer looking
 * up `auth.py:27` needs the former; the latter would send them to the wrong
 * place in any file with more than one hunk.
 */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  if (!diff) return [];
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;

  for (const raw of diff.split("\n")) {
    // Headers first: `+++`/`---` start with the same characters as added and
    // removed lines, so testing for them second would classify every file
    // header as a change.
    if (raw.startsWith("+++") || raw.startsWith("---")) {
      out.push({ kind: "file", text: raw, oldNumber: null, newNumber: null });
      continue;
    }
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      out.push({ kind: "hunk", text: raw, oldNumber: null, newNumber: null });
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), oldNumber: null, newNumber: newNo++ });
      continue;
    }
    if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNumber: oldNo++, newNumber: null });
      continue;
    }
    if (raw.startsWith("\\")) {
      // "\ No newline at end of file" — real diff output, not a content line.
      out.push({ kind: "meta", text: raw, oldNumber: null, newNumber: null });
      continue;
    }
    out.push({ kind: "context", text: raw.slice(1), oldNumber: oldNo++, newNumber: newNo++ });
  }

  // A trailing newline in the diff yields one empty context line that is not
  // part of the file.
  const last = out[out.length - 1];
  if (last && last.kind === "context" && last.text === "") out.pop();

  return out;
}

/** Added and removed line counts, for the summary line above the diff. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "del").length,
  };
}

const ROW_CLASS: Record<DiffLineKind, string> = {
  add: "bg-status-completed-bg/50 text-ink",
  del: "bg-status-failed-bg/40 text-ink",
  hunk: "bg-surface-muted text-ink-soft",
  file: "text-ink-soft",
  meta: "text-ink-soft",
  context: "text-ink-soft",
};

const MARKER: Record<DiffLineKind, string> = {
  add: "+",
  del: "-",
  hunk: "",
  file: "",
  meta: "",
  context: " ",
};

export function DiffView({ diff }: { diff: string }) {
  const lines = parseUnifiedDiff(diff);
  if (lines.length === 0) {
    return <p className="text-[11px] text-ink-soft">The patch bundle carries no diff.</p>;
  }

  return (
    // Wide code scrolls inside its own box; the page never scrolls sideways.
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-muted/30">
      <table className="w-full border-collapse font-mono text-[11px] leading-[1.5]">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className={ROW_CLASS[line.kind]}>
              <td className="w-10 select-none border-r border-border px-1.5 text-right align-top text-ink-soft opacity-60">
                {line.oldNumber ?? ""}
              </td>
              <td className="w-10 select-none border-r border-border px-1.5 text-right align-top text-ink-soft opacity-60">
                {line.newNumber ?? ""}
              </td>
              <td className="w-4 select-none px-1 text-center align-top text-ink-soft">
                {MARKER[line.kind]}
              </td>
              <td className="whitespace-pre px-2 align-top">{line.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
