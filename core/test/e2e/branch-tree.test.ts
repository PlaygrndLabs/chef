import { describe, expect, it } from "vitest";
import { readSpec } from "../../src/spec/lint.ts";
import { templateTree, world } from "../harness.ts";
import { bootstrapTree, MENU_PATH, presets, promptFor, script } from "../scenarios/shared-menu.ts";

const PARTS = "Add tags and search pages under notes";
const SPLITS = new Map([
  [
    PARTS,
    [
      { kind: "new", prompt: promptFor("tags"), parent: "notes" },
      { kind: "new", prompt: promptFor("search"), parent: "notes" },
    ] as const,
  ],
]);

async function project() {
  const w = world({ script, presets: presets(), splits: SPLITS });
  await w.orchestrator.bootstrap(bootstrapTree(templateTree()));
  return w;
}

describe("session branches form a tree", () => {
  it("branches children from a parent that is still building, keeps siblings apart and merges each child into its parent when it is done", async () => {
    const w = await project();
    const mainBefore = (await w.orchestrator.mainTree()).commitId;
    const notes = (await w.orchestrator.submit(promptFor("notes"))).sessionId as string;
    await w.orchestrator.step(notes);
    await w.orchestrator.step(notes);
    const parentHead = (await w.orchestrator.session(notes)).head as string;

    const [tags, search] = (await w.orchestrator.submit(PARTS)).sessionIds as [string, string];
    await w.orchestrator.step(tags);
    await w.orchestrator.step(search);
    for (const id of [tags, search]) {
      const record = await w.orchestrator.session(id);
      expect(record.plan.feature.parent).toBe("notes");
      expect(record.upstream).toBe(notes);
      expect(record.upstreamBase).toBe(parentHead);
      expect(parentHead).not.toBe(mainBefore);
    }

    const tagged = await w.orchestrator.run(tags);
    expect(tagged.machine.state).toBe("merged");
    expect(tagged.merge?.into).toBe(notes);
    expect((await w.orchestrator.mainTree()).commitId).toBe(mainBefore);
    expect(w.bus.log.some((e) => e.type === "branch.merged" && e.sessionId === tags && e.into === notes)).toBe(true);
    expect(w.bus.log.some((e) => e.type === "main.merged" && e.sessionId === tags)).toBe(false);

    const sibling = await w.orchestrator.session(search);
    expect(sibling.commits.some((c) => tagged.commits.includes(c))).toBe(false);
    const siblingTree = (await w.repos.readCommit(sibling.fork, sibling.head as string))?.tree ?? {};
    expect(siblingTree["features/tags/index.ts"]).toBeUndefined();

    const parent = await w.orchestrator.session(notes);
    expect(parent.head).toBe(tagged.merge?.commitId);
    const parentTree = (await w.repos.readCommit(parent.fork, parent.head as string))?.tree ?? {};
    expect(parentTree["features/tags/index.ts"]).toBeDefined();
    expect(readSpec(parentTree).find((f) => f.id === "tags")?.status).toBe("merged");

    const searched = await w.orchestrator.run(search);
    expect(searched.machine.state).toBe("merged");
    expect(searched.merge?.into).toBe(notes);
    const done = await w.orchestrator.run(notes);
    expect(done.machine.state).toBe("merged");
    const main = await w.orchestrator.mainTree();
    for (const id of ["notes", "tags", "search"]) {
      expect(readSpec(main.tree).find((f) => f.id === id)?.status).toBe("merged");
      expect(main.tree[MENU_PATH]).toContain(`"${id}",`);
    }
    expect(main.tree[MENU_PATH]).not.toContain("<<<<<<<");

    const history = await w.orchestrator.sessionHistory(tags);
    expect(history.upstream).toMatchObject({ session: notes, feature: "notes" });
    expect(history.into).toBe(notes);
    expect(history.commits.length).toBe(tagged.commits.length);
    expect((await w.orchestrator.changes(tags)).files.some((f) => f.path === "features/tags/index.ts")).toBe(true);
    expect((await w.orchestrator.turns(tags)).every((t) => t.note !== null)).toBe(true);
    expect(await w.orchestrator.sessionCommit(tags, tagged.commits[0] as string)).not.toBeNull();
  });

  it("branches from main when the parent is already live", async () => {
    const w = await project();
    await w.orchestrator.run((await w.orchestrator.submit(promptFor("notes"))).sessionId as string);
    const [tags] = (await w.orchestrator.submit(PARTS)).sessionIds as [string];
    const record = await w.orchestrator.run(tags);
    expect(record.machine.state).toBe("merged");
    expect(record.upstream).toBeNull();
    expect(record.merge?.into).toBeUndefined();
    expect(w.bus.log.some((e) => e.type === "main.merged" && e.sessionId === tags)).toBe(true);
  });

  it("does not hand main's new commits to a session in the middle of its work", async () => {
    const w = await project();
    await w.orchestrator.run((await w.orchestrator.submit(promptFor("notes"))).sessionId as string);
    const [tags, search] = (await w.orchestrator.submit(PARTS)).sessionIds as [string, string];
    await w.orchestrator.step(search);
    await w.orchestrator.step(search);
    const tagged = await w.orchestrator.run(tags);
    expect(tagged.machine.state).toBe("merged");
    await w.orchestrator.step(search);
    const working = await w.orchestrator.session(search);
    expect(working.syncPending).toBe(false);
    expect(working.commits.some((c) => tagged.commits.includes(c))).toBe(false);
    const done = await w.orchestrator.run(search);
    expect(done.machine.state).toBe("merged");
    expect((await w.orchestrator.mainTree()).tree[MENU_PATH]).toContain('"tags",');
  });
});
