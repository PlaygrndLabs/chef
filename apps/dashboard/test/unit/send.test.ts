import { describe, expect, it } from "vitest";
import { sendError } from "../../src/lib/send.ts";

describe("failed sends", () => {
  it("shows why Chef refused a message", () => {
    expect(sendError('prompts failed: 402 {"error":"This project reached its monthly limit."}')).toBe("This project reached its monthly limit.");
  });

  it("says nothing more when the message never got through", () => {
    expect(sendError("Thread already running")).toBeNull();
    expect(sendError("prompts failed: 500 Internal Server Error")).toBeNull();
    expect(sendError('prompts failed: 500 {"error":"')).toBeNull();
  });
});
