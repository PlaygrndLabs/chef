import type { ChoiceAnswer, ChoiceAnswers, ChoiceQuestions, Classifier } from "../ports/classifier.ts";

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);
}

function stem(word: string): string {
  return word.replace(/(?:ing|ed|es|s)$/u, "");
}

export class KeywordClassifier implements Classifier {
  readonly model = "fake-keyword-classifier";
  readonly calls: { state: unknown; questions: ChoiceQuestions }[] = [];

  constructor(private readonly overrides: ReadonlyMap<string, Readonly<Record<string, string>>> = new Map()) {}

  async choose<const Q extends ChoiceQuestions>(state: unknown, questions: Q): Promise<ChoiceAnswers<Q>> {
    this.calls.push({ state, questions });
    const text = typeof state === "string" ? state : JSON.stringify(state);
    const prompt = typeof state === "object" && state !== null && "prompt" in state ? String((state as { prompt: unknown }).prompt) : text;
    const override = this.overrides.get(prompt);
    const stateWords = new Set(words(prompt).map(stem));
    const answers: Record<string, ChoiceAnswer> = {};
    for (const [name, question] of Object.entries(questions)) {
      const labels = Object.keys(question.criteria);
      const forced = override?.[name];
      const scores = labels.map((label) => {
        if (forced) return label === forced ? 6 : 0;
        const description = `${label.replace(/[_-]/g, " ")} ${question.criteria[label] ?? ""}`;
        const hits = words(description).filter((w) => stateWords.has(stem(w))).length;
        return hits;
      });
      const exp = scores.map((s) => Math.exp(s * 1.5));
      const total = exp.reduce((a, b) => a + b, 0);
      const probabilities: Record<string, number> = {};
      labels.forEach((label, i) => (probabilities[label] = (exp[i] as number) / total));
      const best = labels.reduce((a, b) => ((probabilities[b] as number) > (probabilities[a] as number) ? b : a));
      const n = labels.length;
      const confidence = n > 1 ? Math.max(0, ((probabilities[best] as number) - 1 / n) / (1 - 1 / n)) : 1;
      answers[name] = { choice: best, confidence, probabilities };
    }
    return answers as ChoiceAnswers<Q>;
  }
}
