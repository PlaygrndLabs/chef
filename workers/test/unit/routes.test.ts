import { describe, expect, it } from "vitest";
import { projectOf } from "../../src/routes.ts";

describe("project routes", () => {
  it("sends feature moves, renames and deletes to the project", () => {
    expect(projectOf("/api/projects/treetest/features/edit-todo-items")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/sessions/s1/retry")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/sessions/s1/cloudflare")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/usage")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/sessions/s1/sandbox")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/sessions/s1/events")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/history")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/history/0123abc")).toBe("treetest");
    expect(projectOf("/app/treetest/s1a2b3c4")).toBe("treetest");
  });

  it("sends the look and attached images to the project", () => {
    expect(projectOf("/api/projects/treetest/design")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/uploads")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/uploads/0123456789abcdef0123.png")).toBe("treetest");
    expect(projectOf("/api/projects/treetest/uploads/../memory")).toBeNull();
    expect(projectOf("/api/projects/treetest/uploads/notes.txt")).toBeNull();
  });

  it("sends a new app key to the project", () => {
    expect(projectOf("/api/projects/treetest/app-key")).toBe("treetest");
  });

  it("leaves other paths to the app", () => {
    expect(projectOf("/api/projects/treetest/features")).toBeNull();
    expect(projectOf("/api/projects/treetest/features/Edit")).toBeNull();
    expect(projectOf("/api/projects/treetest/sessions/s1/shell")).toBeNull();
    expect(projectOf("/api/projects/treetest/history/main")).toBeNull();
    expect(projectOf("/app")).toBeNull();
  });
});
