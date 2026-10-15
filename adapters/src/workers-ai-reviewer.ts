import { gemmaPrompt, parseReviewAnswer, reviewMessages, type PickInput, type PickVerdict, type ReviewInput, type ReviewVerdict, type Reviewer } from "@chef/core";

export interface TextGenerator {
  run(model: string, input: { prompt: string; raw: boolean; lora: string; max_tokens: number; temperature: number }): Promise<unknown>;
}

export const LORA_BASE_MODEL = "@cf/google/gemma-2b-it-lora";

export class WorkersAiReviewer implements Reviewer {
  readonly model: string;

  constructor(
    private readonly ai: TextGenerator,
    private readonly lora: string,
    private readonly picker: Reviewer,
    private readonly baseModel: string = LORA_BASE_MODEL,
  ) {
    this.model = `${baseModel}+${lora}`;
  }

  async review(input: ReviewInput): Promise<ReviewVerdict> {
    if (input.ownStructure) return this.picker.review(input);
    const output = await this.ai.run(this.baseModel, { prompt: gemmaPrompt(reviewMessages(input)), raw: true, lora: this.lora, max_tokens: 48, temperature: 0 });
    const text = (output as { response?: unknown } | null)?.response;
    if (typeof text !== "string") throw new Error(`${this.model} returned no text`);
    return { ...parseReviewAnswer(text), model: this.model };
  }

  pick(input: PickInput): Promise<PickVerdict> {
    return this.picker.pick(input);
  }
}
