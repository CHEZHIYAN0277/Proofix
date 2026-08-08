/**
 * `FEATURE_WORKSPACE_V2` (blueprint §11).
 *
 * All Workspace V2 work — including the `/design` gallery — lives behind this
 * flag. Off ⇒ `/v2/*` and `/design` render not-found. V1 `/runs/$runId` is
 * never redirected before Phase 11.
 *
 * Resolution order:
 *   1. `?v2=1` / `?v2=0` in the URL, which is also persisted;
 *   2. the persisted `localStorage` override;
 *   3. `VITE_FEATURE_WORKSPACE_V2`.
 *
 * SSR-safe: with no `window`, only the env default applies. The override is a
 * client concern, so a route gate must resolve it after mount rather than
 * during the server render.
 */

export const FLAG_STORAGE_KEY = "proofix.feature.workspace-v2";
export const FLAG_SEARCH_PARAM = "v2";

/** The build-time default. */
export function envFlagDefault(): boolean {
  const raw = import.meta.env.VITE_FEATURE_WORKSPACE_V2;
  if (raw === undefined || raw === null || raw === "") return false;
  return raw === "1" || raw === "true";
}

function readOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(FLAG_STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Storage can be blocked (private mode, embedded contexts). The env
    // default is the correct answer then, not a crash.
  }
  return null;
}

function writeOverride(value: boolean | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(FLAG_STORAGE_KEY);
    else window.localStorage.setItem(FLAG_STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* non-fatal */
  }
}

/**
 * Applies a `?v2=` search param if present, persisting it, and returns the
 * effective flag value.
 */
export function resolveWorkspaceV2Flag(search?: string): boolean {
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(search ?? window.location.search)
      : new URLSearchParams(search ?? "");

  const param = params.get(FLAG_SEARCH_PARAM);
  if (param === "1" || param === "0") {
    const value = param === "1";
    writeOverride(value);
    return value;
  }

  return readOverride() ?? envFlagDefault();
}

/** Clears the persisted override, falling back to the build-time default. */
export function clearWorkspaceV2Override(): void {
  writeOverride(null);
}

/**
 * Server-render-safe read. During SSR this is the env default; the client
 * upgrades it after mount via `resolveWorkspaceV2Flag`.
 */
export const FEATURE_WORKSPACE_V2 = envFlagDefault();
