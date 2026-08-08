/**
 * `<WorkspaceV2Root>` — the flag gate and run scope (blueprint §4).
 *
 * Off ⇒ not found. The flag's `?v2=` / `localStorage` override is a client
 * concern, so the gate resolves after mount; until it does the route renders
 * nothing rather than flashing a workspace it may be about to 404.
 */

import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { resolveWorkspaceV2Flag } from "@/lib/v2/flag";
import { RunProvider } from "./RunProvider";
import { WorkspaceShell } from "./shell/WorkspaceShell";

export interface WorkspaceV2RootProps {
  runId: string;
  stageId: string;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

export function WorkspaceV2Root({ runId, stageId, follow, onFollowChange }: WorkspaceV2RootProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    setEnabled(resolveWorkspaceV2Flag());
  }, []);

  if (enabled === null) return null;
  if (!enabled) return <FlagDisabled />;

  return (
    <RunProvider runId={runId}>
      <WorkspaceShell stageId={stageId} follow={follow} onFollowChange={onFollowChange} />
    </RunProvider>
  );
}

export function FlagDisabled() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="type-display text-ink">404</h1>
        <h2 className="type-title-2 mt-4 text-ink">Page not found</h2>
        <p className="type-body-sm mt-2 text-ink-soft">
          Workspace V2 is behind <code className="type-mono">FEATURE_WORKSPACE_V2</code>. Enable it
          with <code className="type-mono">VITE_FEATURE_WORKSPACE_V2=1</code>, or append{" "}
          <code className="type-mono">?v2=1</code> to override for this browser.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="type-label inline-flex items-center justify-center rounded-card bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
