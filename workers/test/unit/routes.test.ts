import { describe, expect, it } from "vitest";
import { projectOf } from "../../src/routes.ts";

describe("project routes", () => {
  it("sends feature moves, renames and deletes to the project", () => {
    expect(projectOf("/api/projects/treetest/features/edit-todo-items")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/sessions/s1/retry")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/sessions/s1/cloudflare")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/history")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/history/0123abc")).toBe("treetest");
    expect(projectOf("/preview/treetest/edit-todo-items")).toBe("treetest");
  });

  it("leaves other paths to the app", () => {
    expect(projectOf("/api/projects/treetest/features")).toBeNull();
    expect(projectOf("/api/projects/treetest/features/Edit")).toBeNull();
    expect(projectOf("/api/projects/treetest/sessions/s1/sandbox")).toBeNull();
    expect(projectOf("/api/projects/treetest/history/main")).toBeNull();
    expect(projectOf("/app")).toBeNull();
  });
});
