import { z } from "zod";
import { DEFAULT_PREVIEW_IDLE_MINUTES } from "@chef/core";

export interface ProjectSettings {
  readonly previewIdleMinutes: number;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { previewIdleMinutes: DEFAULT_PREVIEW_IDLE_MINUTES };

export const MAX_PREVIEW_IDLE_MINUTES = 7 * 24 * 60;

const ProjectSettingsUpdate = z.strictObject({
  previewIdleMinutes: z.number().int().min(5, "previews stay up at least 5 minutes").max(MAX_PREVIEW_IDLE_MINUTES, "previews sleep after a week at most").nullable().optional(),
});

export function readProjectSettings(stored: Partial<ProjectSettings> | undefined): ProjectSettings {
  return { ...DEFAULT_PROJECT_SETTINGS, ...stored };
}

export function applyProjectUpdate(stored: Partial<ProjectSettings> | undefined, body: unknown): { ok: true; settings: Partial<ProjectSettings> } | { ok: false; error: string } {
  const parsed = ProjectSettingsUpdate.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  const next: Partial<ProjectSettings> = { ...stored };
  if (parsed.data.previewIdleMinutes === null) delete (next as { previewIdleMinutes?: number }).previewIdleMinutes;
  else if (parsed.data.previewIdleMinutes !== undefined) (next as { previewIdleMinutes?: number }).previewIdleMinutes = parsed.data.previewIdleMinutes;
  return { ok: true, settings: next };
}
