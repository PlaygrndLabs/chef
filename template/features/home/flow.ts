import type { Flow } from "../../shared/flow.ts";

export const flow: Flow = {
  feature: "home",
  steps: [
    {
      name: "AC1: open the home page",
      request: { method: "GET", path: "/" },
      expect: ({ status, body }) => (status === 200 && (body as { ok?: boolean }).ok === true ? null : `expected ok home page, got ${status}`),
    },
  ],
};
