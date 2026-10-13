import { describe, expect, it } from "vitest";
import { projectNameFrom } from "../../src/lib/projects.ts";

describe("naming a project after its repository", () => {
  it("turns a repository name into a valid project name", () => {
    expect(projectNameFrom("PlaygrndLabs/nocheh")).toBe("nocheh");
    expect(projectNameFrom("https://gitlab.com/acme/My_Shop.git")).toBe("my-shop");
    expect(projectNameFrom("acme/2048")).toBe("app-2048");
    expect(projectNameFrom("acme/x")).toBe("xx");
    expect(projectNameFrom(`acme/${"a".repeat(50)}`)).toHaveLength(31);
  });
});
