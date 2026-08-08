/**
 * Repository tree, built from what the backend actually indexed.
 *
 * The blueprint names `workspace.packages` as the source. In practice that is
 * a manifest inventory — one entry for a single-package repo — so it describes
 * the *workspace shape*, not the files. The file inventory lives on the
 * repository graph export, where every node carries a real `file` path.
 *
 * So both are used for what each genuinely knows: packages give the roots and
 * their manifests, the graph export gives the paths underneath. Nothing is
 * synthesised — a path appears only because the backend indexed a node at it.
 */

import type { GraphExport, WorkspacePackage } from "../types";

export interface TreeNode {
  /** Full path from the repository root. */
  path: string;
  /** Last segment — what is displayed. */
  name: string;
  kind: "package" | "directory" | "file";
  children: TreeNode[];
  /** Files only: the node types the graph holds for this path. */
  nodeTypes?: string[];
  /** Files only: how many graph nodes resolve to it. */
  nodeCount?: number;
  /** Packages only: the manifest that declares them. */
  manifest?: string;
  language?: string;
}

/** One row of the flattened, expansion-aware view the list renders. */
export interface FlatTreeRow {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
}

function insert(root: TreeNode, path: string, type: string): void {
  const segments = path.split("/").filter(Boolean);
  let cursor = root;

  segments.forEach((segment, index) => {
    const isLeaf = index === segments.length - 1;
    const full = segments.slice(0, index + 1).join("/");

    let child = cursor.children.find((c) => c.name === segment);
    if (!child) {
      child = {
        path: full,
        name: segment,
        kind: isLeaf ? "file" : "directory",
        children: [],
        ...(isLeaf ? { nodeTypes: [], nodeCount: 0 } : {}),
      };
      cursor.children.push(child);
    }

    if (isLeaf) {
      // A path already seen as a directory stays a directory: a file cannot
      // contain other files, and the graph is the authority on which it is.
      if (child.kind === "file") {
        child.nodeCount = (child.nodeCount ?? 0) + 1;
        if (!child.nodeTypes?.includes(type)) child.nodeTypes?.push(type);
      }
    }
    cursor = child;
  });
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    // Directories before files, then alphabetical — the convention every file
    // explorer uses, so the ordering needs no explanation.
    if (a.kind !== b.kind) {
      if (a.kind === "file") return 1;
      if (b.kind === "file") return -1;
    }
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}

/**
 * Collapse chains of single-child directories into one row (`a/b/c`).
 * Deep Python packages otherwise cost four rows to show one file.
 */
function collapse(node: TreeNode): void {
  node.children.forEach(collapse);
  node.children = node.children.map((child) => {
    let current = child;
    while (
      current.kind === "directory" &&
      current.children.length === 1 &&
      current.children[0].kind === "directory"
    ) {
      const only = current.children[0];
      current = { ...only, name: `${current.name}/${only.name}` };
    }
    return current;
  });
}

export function buildRepositoryTree(
  packages: WorkspacePackage[],
  graph: GraphExport | null | undefined,
): TreeNode[] {
  const paths = new Map<string, string>();
  for (const node of graph?.nodes ?? []) {
    if (node.file) paths.set(`${node.file}::${node.type}`, node.file);
  }

  // One synthetic root per declared package. `path: ""` is the repository root.
  const roots: TreeNode[] = packages.map((pkg) => ({
    path: pkg.path,
    name: pkg.name,
    kind: "package",
    children: [],
    manifest: pkg.manifest,
    language: pkg.language,
  }));

  // No package manifest published — group everything under one unnamed root
  // rather than dropping the tree entirely.
  if (roots.length === 0) {
    roots.push({ path: "", name: "Repository", kind: "package", children: [] });
  }

  for (const node of graph?.nodes ?? []) {
    if (!node.file) continue;
    // Longest matching package prefix wins, so a nested package claims its own
    // files rather than the root swallowing them.
    const owner =
      roots
        .filter((r) => r.path === "" || node.file.startsWith(`${r.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0] ?? roots[0];

    const relative =
      owner.path && node.file.startsWith(`${owner.path}/`)
        ? node.file.slice(owner.path.length + 1)
        : node.file;

    insert(owner, relative, node.type);
  }

  roots.forEach((root) => {
    collapse(root);
    sortTree(root);
  });

  void paths;
  return roots;
}

/** Flatten to the rows a list renders, honouring which nodes are expanded. */
export function flattenTree(
  roots: TreeNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];

  for (const node of roots) {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.path);
    rows.push({ node, depth, expanded: isExpanded, hasChildren });
    if (isExpanded) rows.push(...flattenTree(node.children, expanded, depth + 1));
  }

  return rows;
}

/** Every directory and package path — the initial "expand all" set. */
export function allBranchPaths(roots: TreeNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        out.add(node.path);
        walk(node.children);
      }
    }
  };
  walk(roots);
  return out;
}

export function countFiles(roots: TreeNode[]): number {
  let total = 0;
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "file") total += 1;
      else walk(node.children);
    }
  };
  walk(roots);
  return total;
}
