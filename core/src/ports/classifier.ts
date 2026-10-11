export type ChoiceCriteria = Readonly<Record<string, string | null>>;

export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: T;
}

export interface ChoiceAnswer<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly choice: keyof T & string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<keyof T & string, number>>;
}

export type ChoiceQuestions = Readonly<Record<string, ChoiceQuestion>>;

export type ChoiceAnswers<Q extends ChoiceQuestions> = { readonly [K in keyof Q]: ChoiceAnswer<Q[K]["criteria"]> };

export interface Classifier {
  readonly model: string;
  choose<const Q extends ChoiceQuestions>(state: unknown, questions: Q): Promise<ChoiceAnswers<Q>>;
}
