/**
 * Sample props for the `/design` gallery — and nowhere else.
 *
 * These exist so a primitive can be *demonstrated* in isolation. They are not
 * fixtures, not defaults, and nothing outside `design/gallery/` may import
 * them. The gallery renders no run data (blueprint §3.7), and no component in
 * the design system ships a default value of its own: a missing prop renders
 * `Waiting` / `Pending` / `Unavailable`, which is the whole point.
 *
 * Every value below is obviously synthetic and labelled as such in the UI.
 */

import type { Evidence, SourceRef } from "../types";

export const SAMPLE_EVIDENCE: Evidence[] = [
  {
    signal: "sample_signal_primary",
    value: 3,
    contribution: 0.82,
    detail: "Illustrates a dominant weighted signal",
    provenance: "gallery/samples.ts",
  },
  {
    signal: "sample_signal_secondary",
    value: "sample/path.ext",
    contribution: 0.41,
    detail: "Illustrates a mid-weight signal with a mono value",
    provenance: "gallery/samples.ts",
  },
  {
    signal: "sample_signal_tertiary",
    contribution: 0.12,
    detail: "Illustrates a low-weight signal with no value",
    provenance: "gallery/samples.ts",
  },
];

export const SAMPLE_SOURCE: SourceRef[] = [
  {
    label: "Gallery sample",
    endpoint: "none — this tile renders a synthetic value",
    fieldPath: "gallery.samples.SAMPLE_SOURCE",
  },
];

export const SAMPLE_EXPLAIN = {
  explain: "A synthetic example, shown so the affordance can be inspected in isolation.",
  why: SAMPLE_EVIDENCE,
  confidence: 0.74,
  source: SAMPLE_SOURCE,
};

/** The same spec with no confidence — proves the "Not published" branch. */
export const SAMPLE_EXPLAIN_NO_CONFIDENCE = {
  ...SAMPLE_EXPLAIN,
  confidence: null,
};

export interface SampleRow {
  id: string;
  path: string;
  score: number;
  hops: number;
}

export const SAMPLE_ROWS: SampleRow[] = [
  { id: "r1", path: "sample/module/alpha.ext", score: 0.94, hops: 0 },
  { id: "r2", path: "sample/module/beta.ext", score: 0.71, hops: 1 },
  { id: "r3", path: "sample/module/gamma.ext", score: 0.48, hops: 2 },
  { id: "r4", path: "sample/module/delta.ext", score: 0.22, hops: 3 },
];

export const SAMPLE_CODE = `def sample_function(value):
    """Illustrative only — not repository code."""
    if value is None:
        raise ValueError("value is required")
    return value * 2`;

export const SAMPLE_DIFF = [
  { content: "def sample_function(value):", marker: "context" as const, number: 1 },
  { content: '    """Illustrative only."""', marker: "context" as const, number: 2 },
  { content: "    return value * 2", marker: "remove" as const, number: 3 },
  { content: "    if value is None:", marker: "add" as const, number: 3 },
  { content: '        raise ValueError("value is required")', marker: "add" as const, number: 4 },
  { content: "    return value * 2", marker: "add" as const, number: 5 },
];

/**
 * The same change again, in `<DiffView>`'s shape (Phase 6).
 *
 * Both sides carry line numbers because the component takes tokens from the
 * file each line came from — the added lines index `SAMPLE_DIFF_PATCHED`, the
 * removed and context lines index `SAMPLE_DIFF_ORIGINAL`.
 */
export const SAMPLE_DIFF_ORIGINAL = `def sample_function(value):
    """Illustrative only."""
    return value * 2`;

export const SAMPLE_DIFF_PATCHED = `def sample_function(value):
    """Illustrative only."""
    if value is None:
        raise ValueError("value is required")
    return value * 2`;

export const SAMPLE_DIFF_LINES = [
  {
    content: "@@ -1,3 +1,5 @@",
    marker: "context" as const,
    oldNumber: null,
    newNumber: null,
    hunkHeader: true,
  },
  {
    content: "def sample_function(value):",
    marker: "context" as const,
    oldNumber: 1,
    newNumber: 1,
  },
  {
    content: '    """Illustrative only."""',
    marker: "context" as const,
    oldNumber: 2,
    newNumber: 2,
  },
  { content: "    if value is None:", marker: "add" as const, oldNumber: null, newNumber: 3 },
  {
    content: '        raise ValueError("value is required")',
    marker: "add" as const,
    oldNumber: null,
    newNumber: 4,
  },
  { content: "    return value * 2", marker: "context" as const, oldNumber: 3, newNumber: 5 },
];

/** Agent ids used to demonstrate the deterministic mark generator. */
export const SAMPLE_AGENT_IDS = [
  "A0.5",
  "A1",
  "A2",
  "A3",
  "A3.5",
  "A4",
  "A5",
  "A5.5",
  "A6",
  "A7",
  "A8",
  "A9",
  "A10",
];
