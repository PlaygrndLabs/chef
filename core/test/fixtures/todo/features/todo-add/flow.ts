import type { Flow } from "../../shared/flow.ts";

export const flow: Flow = {
  feature: "todo-add",
  steps: [
    {
      name: "AC1: add an item",
      request: { method: "POST", path: "/todos", body: { text: "buy milk" } },
      expect: ({ status, body }) => (status === 201 && (body as { text?: string }).text === "buy milk" ? null : `expected 201 with the item, got ${status}`),
    },
    {
      name: "AC2: see the item in the list",
      request: { method: "GET", path: "/todos" },
      expect: ({ status, body }) => (status === 200 && Array.isArray(body) && body.some((i: { text?: string }) => i.text === "buy milk") ? null : "item missing from the list"),
    },
    {
      name: "AC3: an empty item is rejected",
      request: { method: "POST", path: "/todos", body: { text: "" } },
      expect: ({ status }) => (status === 400 ? null : `expected 400, got ${status}`),
    },
  ],
};
