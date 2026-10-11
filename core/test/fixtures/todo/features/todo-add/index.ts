import { json, type Feature } from "../../shared/http.ts";

interface Todo {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export const feature: Feature = {
  id: "todo-add",
  title: "Add an item to a todo list",
  routes: [
    {
      method: "POST",
      path: "/todos",
      handle: async (request, { store }) => {
        const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (text.length === 0) return json({ error: "text is required" }, 400);
        const existing = await store.list<Todo>("todo:");
        const todo: Todo = { id: String(existing.length + 1).padStart(6, "0"), text, done: false };
        await store.put(`todo:${todo.id}`, todo);
        return json(todo, 201);
      },
    },
    {
      method: "GET",
      path: "/todos",
      handle: async (_request, { store }) => json(await store.list<Todo>("todo:")),
    },
  ],
};
