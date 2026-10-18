import { describe, expect, it } from "vitest";
import type { RouteDecision } from "@chef/core";
import { routeAnswers } from "../../src/lib/events.ts";

const question: RouteDecision = { intent: "question", featureId: null, changeKind: null, via: "rules", confidence: 1, reason: "" };
const chore: RouteDecision = { ...question, intent: "chore" };

describe("answers in the chat", () => {
  it("keeps an answer with its question when another prompt was routed before it came", () => {
    const live = {
      routes: [
        { prompt: "Map the current features", decision: question, at: 45 },
        { prompt: "Dockerize the project", decision: chore, at: 48 },
      ],
      answers: [{ prompt: "Map the current features", answer: "I added 4 features", at: 59 }],
    };
    expect(routeAnswers(live)).toEqual(["I added 4 features", null]);
  });

  it("gives each of two same questions its own answer, and none to one still waiting", () => {
    const live = {
      routes: [
        { prompt: "how are items stored?", decision: question, at: 1 },
        { prompt: "how are items stored?", decision: question, at: 2 },
        { prompt: "how are items stored?", decision: question, at: 9 },
      ],
      answers: [
        { prompt: "how are items stored?", answer: "first", at: 3 },
        { prompt: "how are items stored?", answer: "second", at: 4 },
      ],
    };
    expect(routeAnswers(live)).toEqual(["first", "second", null]);
  });
});
