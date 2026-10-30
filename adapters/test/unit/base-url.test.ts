import { describe, expect, it } from "vitest";
import { apiRoot, v1Base } from "../../src/base-url.ts";

describe("provider base URLs", () => {
  it("drops /v1 for SDKs that add it themselves", () => {
    for (const url of ["https://gateway.example", "https://gateway.example/", "https://gateway.example/v1", "https://gateway.example/v1/", " https://gateway.example//v1// "]) expect(apiRoot(url)).toBe("https://gateway.example");
    expect(apiRoot("https://chef.example/llm/model")).toBe("https://chef.example/llm/model");
    expect(apiRoot("https://gateway.example/api/v1")).toBe("https://gateway.example/api");
    expect(apiRoot("https://gateway.example/v10")).toBe("https://gateway.example/v10");
    expect(apiRoot("http://v1")).toBe("http://v1");
    expect(apiRoot("http://v1:8080/v1")).toBe("http://v1:8080");
  });

  it("adds /v1 to a bare host and keeps any path the provider gave", () => {
    for (const url of ["https://gateway.example", "https://gateway.example/", "https://gateway.example/v1", "https://gateway.example/v1/", " https://gateway.example// "]) expect(v1Base(url)).toBe("https://gateway.example/v1");
    expect(v1Base("https://chef.example/llm/voice")).toBe("https://chef.example/llm/voice");
    expect(v1Base("https://openrouter.example/api/v1")).toBe("https://openrouter.example/api/v1");
    expect(v1Base("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787/v1");
  });
});
