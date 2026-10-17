import { TypeSafeClient, type TypeSafeClientConfig } from "@typesafe-ai/sdk";
import type { ChoiceAnswers, ChoiceQuestions, Classifier, TokenUsage } from "@chef/core";

export type JevUsage = (model: string, usage: TokenUsage) => Promise<void> | void;

export class JevClassifier implements Classifier {
  readonly model: string;

  constructor(
    private readonly client: Pick<TypeSafeClient, "systemOne">,
    model = "jev-1.13.0",
    private readonly onUsage: JevUsage = () => undefined,
  ) {
    this.model = model;
  }

  static fromEnv(config: TypeSafeClientConfig = {}): JevClassifier {
    const model = config.defaultModel ?? process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-1.13.0";
    return new JevClassifier(new TypeSafeClient({ ...config, defaultModel: model }), model);
  }

  async choose<const Q extends ChoiceQuestions>(state: unknown, questions: Q): Promise<ChoiceAnswers<Q>> {
    const request: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string | null> }> = {};
    for (const [name, question] of Object.entries(questions)) request[name] = { type: "choice", instructions: question.instructions, criteria: { ...question.criteria } };
    const result = await this.client.systemOne({ state: state as never, questions: request, model: this.model });
    if (result.usage) await Promise.resolve(this.onUsage(result.model || this.model, { inputTokens: result.usage.input_tokens ?? 0, outputTokens: result.usage.output_tokens ?? 0 })).catch(() => undefined);
    const answers: Record<string, unknown> = {};
    for (const name of Object.keys(questions)) {
      const answer = result.answers[name];
      if (!answer || answer.type !== "choice") throw new Error(`Jev returned no choice answer for ${name}`);
      answers[name] = { choice: answer.choice, confidence: answer.confidence, probabilities: { ...answer.probabilities } };
    }
    return answers as ChoiceAnswers<Q>;
  }
}
