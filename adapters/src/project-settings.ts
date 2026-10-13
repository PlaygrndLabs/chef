import { z } from "zod";
import { DEFAULT_PREVIEW_IDLE_MINUTES, OUTBOUND_MODES, type OutboundMode } from "@chef/core";
import { gitHubRepo } from "./external-git.ts";

export interface GitLinkSettings {
  readonly url: string;
  readonly branch: string;
  readonly token: string | null;
  readonly installation?: number;
  readonly mode: OutboundMode;
  readonly syncBranch: string;
  readonly webhookSecret: string;
}

export interface ProjectSettings {
  readonly previewIdleMinutes: number;
  readonly git: GitLinkSettings | null;
}

export interface ProjectSettingsView {
  readonly previewIdleMinutes: number;
  readonly git: (Omit<GitLinkSettings, "token" | "installation"> & { readonly tokenHint: string | null; readonly pullRequests: boolean; readonly github: boolean }) | null;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { previewIdleMinutes: DEFAULT_PREVIEW_IDLE_MINUTES, git: null };

export const MAX_PREVIEW_IDLE_MINUTES = 7 * 24 * 60;

const branchName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._/-]{1,100}$/, "a branch name uses letters, digits and . _ / -")
  .refine((value) => !value.includes("..") && !value.startsWith("/") && !value.endsWith("/") && !value.endsWith(".lock"), "that is not a valid branch name");

const GitInput = z
  .strictObject({
    url: z
      .string()
      .trim()
      .url("the repository URL must be a full URL")
      .refine((value) => value.startsWith("https://"), "the repository URL must start with https://")
      .refine((value) => !new URL(value).username && !new URL(value).password, "put the access token in its own field, not in the URL")
      .transform((value) => value.replace(/\/+$/, "")),
    branch: branchName.default("main"),
    token: z.string().trim().min(1).max(4096).optional(),
    github: z.boolean().optional(),
    mode: z.enum(OUTBOUND_MODES).default("pull-request"),
    syncBranch: branchName.default("chef"),
  })
  .refine((git) => git.syncBranch !== git.branch, { message: "the sync branch must differ from the main branch; chef never pushes to main" });

const ProjectSettingsUpdate = z.strictObject({
  previewIdleMinutes: z.number().int().min(5, "previews stay up at least 5 minutes").max(MAX_PREVIEW_IDLE_MINUTES, "previews sleep after a week at most").nullable().optional(),
  git: GitInput.nullable().optional(),
});

export function readProjectSettings(stored: Partial<ProjectSettings> | undefined): ProjectSettings {
  return { ...DEFAULT_PROJECT_SETTINGS, ...stored };
}

export function viewProjectSettings(settings: ProjectSettings): ProjectSettingsView {
  const git = settings.git;
  if (!git) return { previewIdleMinutes: settings.previewIdleMinutes, git: null };
  const { token, installation, ...rest } = git;
  return { previewIdleMinutes: settings.previewIdleMinutes, git: { ...rest, tokenHint: token ? (token.length > 8 ? `…${token.slice(-4)}` : "set") : null, pullRequests: gitHubRepo(git.url) !== null, github: installation !== undefined } };
}

export function requestsGitHubApp(body: unknown): string | null {
  const git = (body as { git?: { github?: unknown; url?: unknown } } | null)?.git;
  return git?.github === true && typeof git.url === "string" ? git.url.trim().replace(/\/+$/, "") : null;
}

export function applyProjectUpdate(stored: Partial<ProjectSettings> | undefined, body: unknown, newSecret: () => string, installation: number | null = null): { ok: true; settings: Partial<ProjectSettings> } | { ok: false; error: string } {
  const parsed = ProjectSettingsUpdate.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  const next: { previewIdleMinutes?: number; git?: GitLinkSettings | null } = { ...stored };
  const update = parsed.data;
  if (update.previewIdleMinutes === null) delete next.previewIdleMinutes;
  else if (update.previewIdleMinutes !== undefined) next.previewIdleMinutes = update.previewIdleMinutes;
  if (update.git === null) next.git = null;
  else if (update.git !== undefined) {
    const previous = stored?.git ?? null;
    const sameRepo = previous?.url === update.git.url;
    const viaApp = update.git.github === true;
    if (viaApp && !gitHubRepo(update.git.url)) return { ok: false, error: "connecting through GitHub works with github.com repositories" };
    if (viaApp && installation === null) return { ok: false, error: "chef's GitHub App cannot reach this repository yet; add it to the app on GitHub first" };
    const token = viaApp ? null : (update.git.token ?? (sameRepo && previous?.installation === undefined ? previous?.token : null) ?? null);
    if (!viaApp && update.git.mode !== "off" && !token) return { ok: false, error: "syncing back to the repository needs an access token that can push branches" };
    if ((update.git.mode === "pull-request" || update.git.mode === "feature-pull-requests") && !gitHubRepo(update.git.url)) return { ok: false, error: "pull requests work with github.com repositories; pick the sync branch mode for other hosts" };
    next.git = { url: update.git.url, branch: update.git.branch, token, ...(viaApp && installation !== null ? { installation } : {}), mode: update.git.mode, syncBranch: update.git.syncBranch, webhookSecret: sameRepo && previous ? previous.webhookSecret : newSecret() };
  }
  return { ok: true, settings: next };
}
