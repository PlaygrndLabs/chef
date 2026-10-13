import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validSignature } from "../../src/webhook.ts";

describe("repository webhook signature", () => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts GitHub's HMAC of the body", async () => {
    expect(await validSignature("s3cret", body, sign("s3cret"))).toBe(true);
  });

  it("rejects a missing, malformed or foreign signature", async () => {
    expect(await validSignature("s3cret", body, null)).toBe(false);
    expect(await validSignature("s3cret", body, "sha1=abc")).toBe(false);
    expect(await validSignature("s3cret", body, sign("other"))).toBe(false);
    expect(await validSignature("s3cret", `${body} `, sign("s3cret"))).toBe(false);
  });
});
