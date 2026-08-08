/**
 * `<CommandPalette>` — ⌘K / Ctrl+K (blueprint §7).
 *
 * Mounted at `RunProvider` level so it is available on every V2 route. Built on
 * the existing `cmdk` + Radix Dialog dependency.
 *
 * Behaviour: opens with recent and suggested actions; ≥2 characters queries
 * every provider (debounced 120ms, abortable per keystroke); results grouped by
 * provider; `↑↓` navigate, `⏎` execute, `⌘⏎` opens a route in a new tab, `Esc`
 * closes and restores focus. Fully keyboard-operable and screen-reader
 * labelled.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import {
  FileCode,
  FunctionSquare,
  Moon,
  Network,
  Palette,
  Quote,
  Sun,
  Users,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { agentIcon } from "@/design/identity/icons";
import { glass } from "@/design/tokens/elevation";
import { cn } from "@/lib/utils";
import { agentsQuery, kgViewQuery } from "@/lib/v2/queries";
import { statusLabel } from "@/lib/v2/stages/machine";
import { useRunId } from "../RunProvider";
import { useStageViews } from "../useStageViews";
import {
  readRecency,
  recordRecency,
  scoreAction,
  type PaletteAction,
  type PaletteProvider,
  type RankedGroup,
} from "./providers";

/** Blueprint §7.2 / §14: 120ms debounce, abortable per keystroke. */
const DEBOUNCE_MS = 120;
const MIN_QUERY = 2;
/** The graph export is server-capped; this caps what one keystroke renders. */
const GRAPH_RESULT_CAP = 200;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<RankedGroup[]>([]);

  const navigate = useNavigate();
  const runId = useRunId();
  const { stages } = useStageViews();
  // Only fetched once the palette is opened — the shell never pays for it.
  const graph = useQuery({ ...kgViewQuery(runId, "repository", 600), enabled: open });
  const callGraph = useQuery({ ...kgViewQuery(runId, "call", 600), enabled: open });
  const agents = useQuery({ ...agentsQuery(runId), enabled: open });

  const restoreFocus = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* --- providers ------------------------------------------------------- */

  const providers = useMemo<PaletteProvider[]>(() => {
    const jumpToStage: PaletteProvider = {
      id: "stage",
      title: "Jump to Stage",
      icon: Workflow,
      scope: "run",
      priority: 0,
      search: () =>
        stages.map((stage) => ({
          id: `stage:${stage.id}`,
          kind: "navigate" as const,
          title: stage.label,
          subtitle: `${statusLabel(stage.status)} · ${stage.purpose}`,
          icon: stage.icon ?? Workflow,
          keywords: `${stage.id} stage ${stage.order}`,
          href: `/v2/runs/${runId}/${stage.id}`,
          perform: () =>
            void navigate({
              to: "/v2/runs/$runId/$stageId",
              params: { runId, stageId: stage.id },
            }),
        })),
    };

    const searchAgent: PaletteProvider = {
      id: "agent",
      title: "Search Agent",
      icon: Users,
      scope: "run",
      priority: 1,
      search: () =>
        stages.flatMap((stage) =>
          stage.agents.map((agent) => ({
            id: `agent:${agent.agentId}`,
            kind: "navigate" as const,
            title: agent.name,
            subtitle: `${agent.agentId} · ${statusLabel(agent.status)}`,
            icon: agentIcon(agent.agentId),
            keywords: `${agent.agentId} ${agent.purpose} ${stage.label}`,
            href: `/v2/runs/${runId}/${stage.id}`,
            perform: () =>
              void navigate({
                to: "/v2/runs/$runId/$stageId",
                params: { runId, stageId: stage.id },
              }),
          })),
        ),
    };

    const theme: PaletteProvider = {
      id: "theme",
      title: "Settings · Theme",
      icon: Palette,
      scope: "global",
      priority: 3,
      search: () => [
        {
          id: "theme:light",
          kind: "toggle" as const,
          title: "Switch to light theme",
          icon: Sun,
          keywords: "theme appearance light",
          perform: () => applyTheme("light"),
        },
        {
          id: "theme:dark",
          kind: "toggle" as const,
          title: "Switch to dark theme",
          icon: Moon,
          keywords: "theme appearance dark",
          perform: () => applyTheme("dark"),
        },
      ],
    };

    const settings: PaletteProvider = {
      id: "settings",
      title: "Settings",
      icon: Palette,
      scope: "global",
      priority: 4,
      search: () => [
        {
          id: "settings:design",
          kind: "navigate" as const,
          title: "Open design system gallery",
          subtitle: "/design",
          keywords: "design tokens components gallery",
          href: "/design",
          perform: () => void navigate({ to: "/design" }),
        },
        {
          id: "settings:v1",
          kind: "navigate" as const,
          title: "Open the V1 workspace for this run",
          subtitle: `/runs/${runId}`,
          keywords: "v1 legacy workspace",
          href: `/runs/${runId}`,
          perform: () => void navigate({ to: "/runs/$runId", params: { runId } }),
        },
      ],
    };

    /**
     * Search Graph — the repository graph's node index.
     *
     * The nodes come from the server's own export, capped server-side. The
     * client filters the returned page; it never builds an index of the
     * repository, which is the rule for all symbol search (§7.2).
     */
    const searchGraph: PaletteProvider = {
      id: "graph",
      title: "Search Graph",
      icon: Network,
      scope: "run",
      priority: 2,
      search: (query) => {
        if (query.length < MIN_QUERY) return [];
        const nodes = graph.data?.nodes ?? [];
        return nodes.slice(0, GRAPH_RESULT_CAP).map((node) => ({
          id: `graph:${node.id}`,
          kind: "navigate" as const,
          title: node.label || node.qualname || node.id,
          subtitle: `${node.type}${node.file ? ` · ${node.file}` : ""}`,
          icon: FileCode,
          keywords: `${node.qualname} ${node.file} ${node.type}`,
          href: `/v2/runs/${runId}/repository`,
          perform: () =>
            void navigate({
              to: "/v2/runs/$runId/$stageId",
              params: { runId, stageId: "repository" },
            }),
        }));
      },
    };

    /**
     * Search File — distinct paths the graph indexed, each opening the
     * repository stage where the named queries for it run.
     */
    const searchFile: PaletteProvider = {
      id: "file",
      title: "Search File",
      icon: FileCode,
      scope: "run",
      priority: 2,
      search: (query) => {
        if (query.length < MIN_QUERY) return [];
        const paths = new Set<string>();
        for (const node of graph.data?.nodes ?? []) {
          if (node.file) paths.add(node.file);
        }
        return [...paths].map((path) => ({
          id: `file:${path}`,
          kind: "navigate" as const,
          title: path.split("/").pop() ?? path,
          subtitle: path,
          icon: FileCode,
          keywords: path,
          href: `/v2/runs/${runId}/repository`,
          perform: () =>
            void navigate({
              to: "/v2/runs/$runId/$stageId",
              params: { runId, stageId: "repository" },
            }),
        }));
      },
    };

    /**
     * Search Function / Symbol — callables from the call graph.
     *
     * Server-side traversal, same as every other symbol search: the call export
     * is the server's own index, and selecting a result opens Investigation
     * where the named queries for it run.
     */
    const searchSymbol: PaletteProvider = {
      id: "symbol",
      title: "Search Function",
      icon: FunctionSquare,
      scope: "run",
      priority: 2,
      search: (query) => {
        if (query.length < MIN_QUERY) return [];
        return (callGraph.data?.nodes ?? [])
          .filter((node) => node.type === "function" || node.type === "test")
          .slice(0, GRAPH_RESULT_CAP)
          .map((node) => ({
            id: `symbol:${node.id}`,
            kind: "navigate" as const,
            title: node.qualname || node.label,
            subtitle: node.file,
            icon: FunctionSquare,
            keywords: `${node.label} ${node.file} ${node.type}`,
            href: `/v2/runs/${runId}/investigation`,
            perform: () =>
              void navigate({
                to: "/v2/runs/$runId/$stageId",
                params: { runId, stageId: "investigation" },
              }),
          }));
      },
    };

    /**
     * Search Evidence — the claims and citations agents published.
     *
     * Sourced from each agent's own evidence payload, so a result exists only
     * because an agent stated it. Nothing here is derived from run state.
     */
    const searchEvidence: PaletteProvider = {
      id: "evidence",
      title: "Search Evidence",
      icon: Quote,
      scope: "run",
      priority: 2,
      search: (query) => {
        if (query.length < MIN_QUERY) return [];
        const actions: PaletteAction[] = [];

        for (const entry of agents.data ?? []) {
          const stageId = entry.stage;
          for (const field of entry.evidence?.fields ?? []) {
            actions.push({
              id: `evidence:${entry.agentId}:${field.label}`,
              kind: "navigate",
              title: `${field.label}: ${field.value}`,
              subtitle: `${entry.agent} · ${entry.agentId}`,
              icon: Quote,
              keywords: `${entry.agent} ${entry.handoff} ${field.label} ${field.value}`,
              href: `/v2/runs/${runId}/${stageId}`,
              perform: () =>
                void navigate({
                  to: "/v2/runs/$runId/$stageId",
                  params: { runId, stageId },
                }),
            });
          }
          for (const pill of entry.evidence?.pills ?? []) {
            actions.push({
              id: `evidence:${entry.agentId}:pill:${pill}`,
              kind: "navigate",
              title: pill,
              subtitle: `${entry.agent} · citation`,
              icon: Quote,
              keywords: `${entry.agent} citation ${pill}`,
              href: `/v2/runs/${runId}/${stageId}`,
              perform: () =>
                void navigate({
                  to: "/v2/runs/$runId/$stageId",
                  params: { runId, stageId },
                }),
            });
          }
        }
        return actions;
      },
    };

    return [
      jumpToStage,
      searchAgent,
      searchFile,
      searchSymbol,
      searchGraph,
      searchEvidence,
      theme,
      settings,
    ];
  }, [stages, runId, navigate, graph.data, callGraph.data, agents.data]);

  /* --- open / close ---------------------------------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        restoreFocus.current = document.activeElement as HTMLElement | null;
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setRawQuery("");
    setQuery("");
    // Esc restores focus to whatever had it before the palette opened.
    restoreFocus.current?.focus?.();
  }, []);

  /* --- debounced, abortable search ------------------------------------- */

  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  useEffect(() => {
    if (!open) return;

    // One controller per keystroke: a slower provider from a previous query can
    // never overwrite the results of the current one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const trimmed = query.trim();
    const recency = readRecency();

    void (async () => {
      const results = await Promise.all(
        providers.map(async (provider) => {
          const actions = await provider.search(trimmed);
          return { provider, actions };
        }),
      );
      if (controller.signal.aborted) return;

      const ranked: RankedGroup[] = results
        .map(({ provider, actions }) => {
          const scored = actions
            .map((action) => ({ action, score: scoreAction(action, trimmed, provider, recency) }))
            .filter(
              (entry): entry is { action: PaletteAction; score: number } => entry.score !== null,
            )
            .sort((a, b) => b.score - a.score)
            .map(({ action }) => action);

          // With no query the palette opens on recent + suggested, so each
          // provider contributes a short list rather than its whole catalogue.
          return {
            provider,
            actions: trimmed.length >= MIN_QUERY ? scored : scored.slice(0, 4),
          };
        })
        .filter((group) => group.actions.length > 0);

      setGroups(ranked);
    })();

    return () => controller.abort();
  }, [open, query, providers]);

  /* --- execution -------------------------------------------------------- */

  const run = useCallback(
    (action: PaletteAction) => {
      recordRecency(action.id);
      action.perform();
      close();
    },
    [close],
  );

  const onItemKeyDown = useCallback(
    (event: React.KeyboardEvent, action: PaletteAction) => {
      // ⌘⏎ opens a route in a new tab, where the action is a route.
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && action.href) {
        event.preventDefault();
        recordRecency(action.id);
        window.open(action.href, "_blank", "noopener,noreferrer");
        close();
      }
    },
    [close],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent
        className={cn(glass("command-palette"), "max-w-xl overflow-hidden rounded-overlay p-0")}
        aria-label="Command palette"
      >
        <Command label="Command palette" shouldFilter={false} loop>
          <div className="border-b border-border px-4">
            <Command.Input
              value={rawQuery}
              onValueChange={setRawQuery}
              placeholder="Jump to a stage, find an agent, change the theme…"
              aria-label="Search commands"
              className="type-body h-12 w-full bg-transparent text-ink outline-none placeholder:text-ink-soft/70"
            />
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="type-body-sm px-3 py-6 text-center text-ink-soft">
              No matching actions.
            </Command.Empty>

            {groups.map((group) => (
              <Command.Group
                key={group.provider.id}
                heading={group.provider.title}
                className="[&_[cmdk-group-heading]]:type-eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-ink-soft"
              >
                {group.actions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Command.Item
                      key={action.id}
                      value={action.id}
                      onSelect={() => run(action)}
                      onKeyDown={(event) => onItemKeyDown(event, action)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-card px-2 py-2 data-[selected=true]:bg-surface-muted"
                    >
                      {Icon && (
                        <Icon
                          aria-hidden
                          className="size-4 shrink-0 text-ink-soft"
                          strokeWidth={1.75}
                        />
                      )}
                      <span className="type-body-sm min-w-0 flex-1 truncate text-ink">
                        {action.title}
                      </span>
                      {action.subtitle && (
                        <span className="type-caption min-w-0 max-w-[45%] truncate text-ink-soft">
                          {action.subtitle}
                        </span>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>

          <footer className="type-caption flex items-center gap-3 border-t border-border px-4 py-2 text-ink-soft">
            <span>↑↓ navigate</span>
            <span>⏎ run</span>
            <span>⌘⏎ new tab</span>
            <span>esc close</span>
          </footer>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** Writes the same root class and storage key the rest of the product uses. */
function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    window.localStorage.setItem("proofix-theme", theme);
  } catch {
    /* storage can be blocked; the class still applies for this session */
  }
}
