/**
 * `<WorkspaceShell>` — the three-column layout (blueprint §4, rule A5).
 *
 * `[rail 260px] [center 1fr, max 1100px] [mission-control 360px]`.
 *
 * Rule A5 is a layout constraint, not a preference: **the center column stays
 * optically dominant at every breakpoint.** The rails collapse before the
 * center narrows below 720px — Mission Control goes first at <1280px, then the
 * stage rail at <1024px — so a narrow viewport loses periphery, never the
 * story.
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { useActiveStage, useRunId, useTerminal } from "../RunProvider";
import { CommandPalette } from "../palette/CommandPalette";
import { ChatDock } from "./ChatDock";
import { MissionControl } from "./MissionControl";
import { StageContainer } from "./StageContainer";
import { StageRail } from "./StageRail";
import { WhyPanelHost } from "./WhyPanel";
import { WorkspaceHeader } from "./WorkspaceHeader";

export interface WorkspaceShellProps {
  stageId: string;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

export function WorkspaceShell({ stageId, follow, onFollowChange }: WorkspaceShellProps) {
  const runId = useRunId();
  const navigate = useNavigate();
  const activeStage = useActiveStage();
  const terminal = useTerminal();

  const jumpToStage = useCallback(
    (target: string) => {
      // A deliberate jump is a decision to stop following the run; otherwise
      // the next frame would yank the user back to the active stage.
      onFollowChange(false);
      void navigate({ to: "/v2/runs/$runId/$stageId", params: { runId, stageId: target } });
    },
    [navigate, runId, onFollowChange],
  );

  /**
   * Follow mode: track the active stage as the pipeline advances.
   *
   * Only while the run is still going. On a terminal run there is nothing left
   * to follow, and leaving it on made every stage un-navigable — clicking
   * "Repository Understanding" bounced straight back to the last stage, and so
   * did any deep link into a finished run. Once the story is over the URL is
   * the truth about what is on screen (§12).
   */
  const lastFollowed = useRef<string | null>(null);
  useEffect(() => {
    if (terminal) return;
    if (!follow || !activeStage || activeStage === stageId) return;
    if (lastFollowed.current === activeStage) return;
    lastFollowed.current = activeStage;
    void navigate({
      to: "/v2/runs/$runId/$stageId",
      params: { runId, stageId: activeStage },
      // Carry the search params across. Navigating without them resets the
      // route's search, which dropped `follow=true` on the very first hop —
      // so following advanced exactly one stage and then silently stopped.
      search: (prev) => prev,
      replace: true,
    });
  }, [follow, activeStage, stageId, navigate, runId, terminal]);

  return (
    <WhyPanelHost>
      <div className="flex h-screen min-h-0 flex-col bg-background">
        {/* Mounted above everything so ⌘K works from any focus target. */}
        <CommandPalette />

        <WorkspaceHeader />

        <div className="flex min-h-0 flex-1">
          {/* Rail collapses below 1024px — the center never narrows for it. */}
          <div className="hidden lg:block">
            <StageRail currentStageId={stageId} />
          </div>

          <main className="flex min-w-0 flex-1 flex-col">
            <StageContainer stageId={stageId} follow={follow} onFollowChange={onFollowChange} />
          </main>

          {/* Mission Control collapses first, below 1280px. */}
          <div className="hidden xl:block">
            <MissionControl onJumpToStage={jumpToStage} />
          </div>
        </div>

        <ChatDock />
      </div>
    </WhyPanelHost>
  );
}
