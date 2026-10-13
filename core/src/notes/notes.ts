import { z } from "zod";

export const NOTES_NAMESPACE = "refs/notes/chef";
export const PROOF_NAMESPACE = "refs/notes/chef-proof";

export const TurnNote = z.strictObject({
  chef: z.literal(1),
  project: z.string(),
  feature: z.string(),
  session: z.string(),
  role: z.string(),
  kind: z.enum(["spec_change", "test", "code", "fix", "refactor", "chore", "conflict", "sync", "revert", "merge", "scaffold"]),
  workItem: z.string().nullable(),
  prompt: z.string(),
  rootPrompt: z.string(),
  runId: z.string(),
  model: z.string(),
  specRevision: z.number().int().nonnegative(),
  paths: z.array(z.string()),
});

export type TurnNote = z.infer<typeof TurnNote>;

export function renderNote(note: TurnNote): string {
  return `${JSON.stringify(TurnNote.parse(note), null, 2)}\n`;
}

export function parseNote(text: string | null): TurnNote | null {
  if (!text) return null;
  try {
    const result = TurnNote.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
