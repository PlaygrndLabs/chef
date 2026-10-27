import { z } from "zod";
import { structured, type LlmEndpoint } from "./anthropic.ts";

const Score = (what: string) => z.number().int().min(1).max(10).describe(what);

const JudgeSchema = z.object({
  typography: Score("Type: a clear scale from display to body, a pairing that suits the brand, comfortable line length and spacing, nothing that reads as browser defaults."),
  color: Score("Color: a deliberate palette with one or two accents, enough contrast everywhere, the dark view as considered as the light one when there is one."),
  layout: Score("Layout: alignment, a consistent spacing rhythm, sections that differ in shape, a clear path for the eye, no cramped or empty stretches."),
  polish: Score("Polish: details a designer would add (imagery or illustration, hover-ready buttons, icons, footers, empty states) and nothing broken, overlapping, cut off or placeholder-looking."),
  phone: Score("Phone: the phone view is designed rather than squeezed, with readable sizes and tap-sized controls."),
  fit: Score("Fit: how well the pages answer the request, including its brand, audience and any reference it names."),
  verdict: z.string().describe("One or two sentences: would a design-minded visitor take this for a real product, and why or why not."),
  fixes: z.array(z.string()).max(3).describe("The three changes that would raise the scores most, most important first, each concrete enough to act on."),
});

export type DesignScores = z.infer<typeof JudgeSchema> & { readonly overall: number; readonly model: string };

const SYSTEM = `You are a senior product designer judging screenshots of a web app an AI agent built from one request. Score what you see, not what the request hoped for, on a scale where 5 is a tidy template, 7 is good studio work and 9 is award-level. Be strict and consistent: two apps of the same quality get the same scores whoever built them. Images come in the order given in the list of shots.`;

export async function judgeDesign(llm: LlmEndpoint, model: string, input: { readonly request: string; readonly shots: readonly { readonly label: string; readonly png: string }[] }): Promise<DesignScores> {
  const list = input.shots.map((shot, i) => `${i + 1}. ${shot.label}`).join("\n");
  const result = await structured(llm, {
    model,
    system: SYSTEM,
    effort: "medium",
    schema: JudgeSchema,
    images: input.shots.map((shot) => shot.png),
    prompt: `The request:\n${input.request}\n\nThe shots:\n${list}`,
  });
  const parts = [result.typography, result.color, result.layout, result.polish, result.phone, result.fit];
  return { ...result, overall: Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10, model };
}
