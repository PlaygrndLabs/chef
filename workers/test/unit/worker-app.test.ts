import { describe, expect, it } from "vitest";
import { assetPath, contentType, moduleKind, wrapperModule } from "../../src/worker-app.ts";

describe("main's app on a Dynamic Worker", () => {
  const meta = { notFound: "none" as const, assets: Object.fromEntries(["/index.html", "/notes.html", "/docs/index.html", "/client.js", "/fonts/geist.woff2"].map((path) => [path, { type: contentType(path), size: 1, etag: "e", chunks: 1 }])) };

  it("serves static files before the Worker, the way Workers static assets do", () => {
    expect(assetPath(meta, "/", true)).toBe("/index.html");
    expect(assetPath(meta, "/notes", true)).toBe("/notes.html");
    expect(assetPath(meta, "/docs", true)).toBe("/docs/index.html");
    expect(assetPath(meta, "/docs/", true)).toBe("/docs/index.html");
    expect(assetPath(meta, "/client.js", false)).toBe("/client.js");
    expect(assetPath(meta, "/api/notes", false)).toBeNull();
    expect(assetPath(meta, "/notes/42", true)).toBeNull();
    expect(assetPath({ ...meta, notFound: "single-page-application" }, "/notes/42", true)).toBe("/index.html");
    expect(assetPath({ ...meta, notFound: "single-page-application" }, "/api/notes", false)).toBeNull();
    expect(assetPath(meta, "/%E0%A4%A", true)).toBeNull();
  });

  it("names file types and Worker module kinds", () => {
    expect(contentType("/fonts/geist.woff2")).toBe("font/woff2");
    expect(contentType("/index.html")).toBe("text/html; charset=utf-8");
    expect(contentType("/blob")).toBe("application/octet-stream");
    expect(moduleKind("index.js")).toBe("js");
    expect(moduleKind("chunk.cjs")).toBe("cjs");
    expect(moduleKind("lib.wasm")).toBe("wasm");
    expect(moduleKind("index.js.map")).toBeNull();
  });

  it("gives the app its Durable Object bindings through Chef, and keeps Chef's binding out of the app's env", () => {
    const code = wrapperModule({ mainModule: "index.js", objects: [{ binding: "STORE", className: "StoreObject" }] });
    expect(code).toContain('import * as app from "./index.js";');
    expect(code).toContain('export * from "./index.js";');
    expect(code).toContain('const OBJECTS = ["STORE"];');
    expect(code).toContain("delete scoped.CHEF_OBJECTS;");
  });
});
