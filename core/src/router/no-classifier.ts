import type { ChoiceAnswer, ChoiceAnswers, ChoiceQuestions, Classifier } from "../ports/classifier.ts";

export const NO_CLASSIFIER: Classifier = {
  model: "none",
  async choose<const Q extends ChoiceQuestions>(_state: unknown, questions: Q): Promise<ChoiceAnswers<Q>> {
    const answers: Record<string, ChoiceAnswer> = {};
    for (const [name, question] of Object.entries(questions)) {
      const labels = Object.keys(question.criteria);
      const probabilities = Object.fromEntries(labels.map((label) => [label, 1 / labels.length]));
      answers[name] = { choice: labels[0] as string, confidence: 0, probabilities };
    }
    return answers as ChoiceAnswers<Q>;
  },
};
