import { z } from "zod";
import type { FileChanges, Tree } from "../git/tree.ts";
import { entryChanges, freeName, isFeaturePath, MAP_STATES, moveChanges, nameOf, parentOf, readFeatureMap, removeChanges, renderPath, START_FILE, subtreeIds } from "./map.ts";

const Title = z.string().trim().min(1, "the title needs text").max(120);
const Id = z.string().refine(isFeaturePath, "not a feature in the list");
const Text = z.string().max(20_000);

export const MapEdit = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("add"), parent: Id.nullable(), title: Title, state: z.enum(MAP_STATES).optional(), path: Text.optional(), specs: Text.optional() }),
  z.strictObject({ kind: z.literal("update"), id: Id, title: Title.optional(), state: z.enum(MAP_STATES).optional(), path: Text.optional(), specs: Text.optional() }),
  z.strictObject({ kind: z.literal("move"), id: Id, parent: Id.nullable() }),
  z.strictObject({ kind: z.literal("remove"), id: Id }),
  z.strictObject({ kind: z.literal("start"), path: Text }),
]);

export type MapEdit = z.infer<typeof MapEdit>;

export type MapEditResult = { readonly ok: true; readonly changes: FileChanges; readonly message: string; readonly id: string | null } | { readonly ok: false; readonly error: string };

export function applyMapEdit(tree: Tree, edit: MapEdit): MapEditResult {
  const map = readFeatureMap(tree);
  const find = (id: string) => map.features.find((f) => f.id === id);
  switch (edit.kind) {
    case "start":
      return { ok: true, changes: { [START_FILE]: renderPath(edit.path) }, message: "Feature list: how to start the project", id: null };
    case "add": {
      if (edit.parent && !find(edit.parent)) return { ok: false, error: `unknown feature ${edit.parent}` };
      const name = freeName(map, edit.title);
      const id = edit.parent ? `${edit.parent}/${name}` : name;
      const state = edit.state ?? "wish";
      return { ok: true, changes: entryChanges({ id, title: edit.title, state, path: edit.path ?? "", specs: edit.specs ?? "" }), message: `Feature list: add ${state === "wish" ? "wish " : ""}${edit.title}`, id };
    }
    case "update": {
      const feature = find(edit.id);
      if (!feature) return { ok: false, error: `unknown feature ${edit.id}` };
      const next = { id: feature.id, title: edit.title ?? feature.title, state: edit.state ?? feature.state, path: edit.path ?? feature.path, specs: edit.specs ?? feature.specs };
      return { ok: true, changes: entryChanges(next), message: `Feature list: update ${next.title}`, id: feature.id };
    }
    case "move": {
      const feature = find(edit.id);
      if (!feature) return { ok: false, error: `unknown feature ${edit.id}` };
      if (edit.parent && !find(edit.parent)) return { ok: false, error: `unknown feature ${edit.parent}` };
      if (edit.parent && subtreeIds(map, edit.id).includes(edit.parent)) return { ok: false, error: "a feature cannot go under itself or one of its own parts" };
      if ((edit.parent ?? null) === parentOf(edit.id)) return { ok: true, changes: {}, message: "", id: edit.id };
      const to = edit.parent ? `${edit.parent}/${nameOf(edit.id)}` : nameOf(edit.id);
      return { ok: true, changes: moveChanges(tree, edit.id, to), message: `Feature list: move ${feature.title}${edit.parent ? ` under ${find(edit.parent)?.title ?? edit.parent}` : " to the top"}`, id: to };
    }
    case "remove": {
      const feature = find(edit.id);
      if (!feature) return { ok: false, error: `unknown feature ${edit.id}` };
      return { ok: true, changes: removeChanges(tree, edit.id), message: `Feature list: remove ${feature.title}`, id: edit.id };
    }
  }
}
