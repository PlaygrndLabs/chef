import type { FeatureSpec } from "@kargah/core";

export type Fault = "vacuous-test" | "missed-edge" | "gate-caught" | "none";

export interface Example {
  readonly input: string;
  readonly output: string | number | boolean;
}

export interface BenchItem {
  readonly id: string;
  readonly title: string;
  readonly fault: Fault;
  readonly normal: Example & { readonly text: string };
  readonly edge: Example & { readonly text: string };
  readonly weak: Example;
  readonly hidden: readonly Example[];
  readonly correct: string;
  readonly buggy: string;
}

export const BENCH_ITEMS: readonly BenchItem[] = [
  {
    id: "shout",
    title: "Shout a phrase",
    fault: "vacuous-test",
    normal: { text: "POST /shout uppercases the value and adds an exclamation mark", input: "hi", output: "HI!" },
    edge: { text: "surrounding whitespace is trimmed before shouting", input: "  hi  ", output: "HI!" },
    weak: { input: "hey", output: "HEY!" },
    hidden: [{ input: "\tgo team\n", output: "GO TEAM!" }],
    correct: "return `${value.trim().toUpperCase()}!`;",
    buggy: "return `${value.toUpperCase()}!`;",
  },
  {
    id: "slug",
    title: "Turn a title into a slug",
    fault: "vacuous-test",
    normal: { text: "POST /slug lowercases the value and joins words with dashes", input: "Hello World", output: "hello-world" },
    edge: { text: "runs of spaces become a single dash", input: "Hello   World", output: "hello-world" },
    weak: { input: "Big Day", output: "big-day" },
    hidden: [{ input: " Many   Small  Words ", output: "many-small-words" }],
    correct: 'return value.trim().toLowerCase().split(/\\s+/).filter(Boolean).join("-");',
    buggy: 'return value.toLowerCase().replaceAll(" ", "-");',
  },
  {
    id: "word-count",
    title: "Count the words in a text",
    fault: "vacuous-test",
    normal: { text: "POST /word-count returns the number of words", input: "one two three", output: 3 },
    edge: { text: "an empty text has zero words", input: "", output: 0 },
    weak: { input: "a b", output: 2 },
    hidden: [{ input: "   ", output: 0 }, { input: " spaced  out ", output: 2 }],
    correct: "return value.split(/\\s+/).filter(Boolean).length;",
    buggy: 'return value.split(" ").length;',
  },
  {
    id: "reverse",
    title: "Reverse a text",
    fault: "missed-edge",
    normal: { text: "POST /reverse returns the characters in reverse order", input: "abc", output: "cba" },
    edge: { text: "emoji and other astral characters stay intact", input: "ab😀", output: "😀ba" },
    weak: { input: "kargah", output: "hagrak" },
    hidden: [{ input: "🙂x", output: "x🙂" }],
    correct: 'return [...value].reverse().join("");',
    buggy: 'return value.split("").reverse().join("");',
  },
  {
    id: "initials",
    title: "Get the initials of a name",
    fault: "missed-edge",
    normal: { text: "POST /initials returns the first letter of each word", input: "Ada Lovelace", output: "AL" },
    edge: { text: "initials are uppercase even when the name is not", input: "ada lovelace", output: "AL" },
    weak: { input: "Grace Hopper", output: "GH" },
    hidden: [{ input: "alan mathison turing", output: "AMT" }],
    correct: 'return value.split(/\\s+/).filter(Boolean).map((word) => (word[0] ?? "").toUpperCase()).join("");',
    buggy: 'return value.split(/\\s+/).filter(Boolean).map((word) => word[0] ?? "").join("");',
  },
  {
    id: "vowels",
    title: "Count the vowels in a text",
    fault: "missed-edge",
    normal: { text: "POST /vowels returns how many vowels the value has", input: "kargah", output: 2 },
    edge: { text: "uppercase vowels count too", input: "AEi", output: 3 },
    weak: { input: "banana", output: 3 },
    hidden: [{ input: "Orange", output: 3 }],
    correct: 'return [...value.toLowerCase()].filter((c) => "aeiou".includes(c)).length;',
    buggy: 'return [...value].filter((c) => "aeiou".includes(c)).length;',
  },
  {
    id: "title-case",
    title: "Title case a phrase",
    fault: "gate-caught",
    normal: { text: "POST /title-case capitalizes every word", input: "hello world", output: "Hello World" },
    edge: { text: "the rest of each word is lowercased", input: "hELLO", output: "Hello" },
    weak: { input: "x", output: "X" },
    hidden: [{ input: "tHE gREAT gATSBY", output: "The Great Gatsby" }],
    correct: 'return value.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");',
    buggy: "return value.charAt(0).toUpperCase() + value.slice(1);",
  },
  {
    id: "digit-sum",
    title: "Sum the digits in a text",
    fault: "gate-caught",
    normal: { text: "POST /digit-sum adds up every digit in the value", input: "a1b2c3", output: 6 },
    edge: { text: "a value without digits sums to zero", input: "abc", output: 0 },
    weak: { input: "1", output: 1 },
    hidden: [{ input: "9 lives, 9 tails", output: 18 }],
    correct: 'return [...value].filter((c) => c >= "0" && c <= "9").reduce((sum, c) => sum + Number(c), 0);',
    buggy: "return (value.match(/\\d/g) ?? []).length;",
  },
  {
    id: "truncate",
    title: "Truncate a long text",
    fault: "none",
    normal: { text: "POST /truncate cuts values longer than 10 characters and adds an ellipsis", input: "abcdefghijklmn", output: "abcdefghij…" },
    edge: { text: "a value of exactly 10 characters is unchanged", input: "abcdefghij", output: "abcdefghij" },
    weak: { input: "short", output: "short" },
    hidden: [{ input: "", output: "" }],
    correct: "return value.length > 10 ? `${value.slice(0, 10)}…` : value;",
    buggy: "return value.length >= 10 ? `${value.slice(0, 10)}…` : value;",
  },
  {
    id: "palindrome",
    title: "Check whether a word is a palindrome",
    fault: "none",
    normal: { text: "POST /palindrome answers true for a word that reads the same backwards", input: "level", output: true },
    edge: { text: "letter case is ignored", input: "Racecar", output: true },
    weak: { input: "noon", output: true },
    hidden: [{ input: "kargah", output: false }],
    correct: 'const lower = value.toLowerCase();\n  return lower === [...lower].reverse().join("");',
    buggy: 'return value === [...value].reverse().join("");',
  },
];

export function promptFor(item: BenchItem): string {
  return `${item.title} via POST /${item.id}`;
}

export function specFor(item: BenchItem): FeatureSpec {
  return {
    id: item.id,
    title: item.title,
    status: "building",
    entrypoint: `POST /${item.id}`,
    revision: 1,
    shared: [],
    acceptance: [
      { id: "AC1", text: item.normal.text },
      { id: "AC2", text: item.edge.text },
      { id: "AC3", text: "a value that is not a string is rejected with 400" },
    ],
    body: `${item.title}. The value is sent as JSON { "value": "..." } and the answer is { "result": ... }.`,
  };
}

const lit = (value: unknown) => JSON.stringify(value);

export function implementation(item: BenchItem, body: string): string {
  const returns = typeof item.normal.output === "string" ? "string" : typeof item.normal.output === "number" ? "number" : "boolean";
  return `import { json, type Feature } from "../../shared/http.ts";

export function compute(value: string): ${returns} {
  ${body}
}

export const feature: Feature = {
  id: ${lit(item.id)},
  title: ${lit(item.title)},
  routes: [
    {
      method: "POST",
      path: ${lit(`/${item.id}`)},
      handle: async (request) => {
        const body = (await request.json().catch(() => null)) as { value?: unknown } | null;
        if (typeof body?.value !== "string") return json({ error: "value must be a string" }, 400);
        return json({ result: compute(body.value) });
      },
    },
  ],
};
`;
}

const CALL = (id: string, from: string) => `import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "${from}shared/http.ts";
import { MemoryStore } from "${from}shared/storage.ts";
import { feature } from "${from}features/${id}/index.ts";

async function call(value: unknown): Promise<{ status: number; result: unknown }> {
  const app = createApp([feature], new MemoryStore());
  const response = await app(new Request("http://app.test/${id}", { method: "POST", body: JSON.stringify({ value }), headers: { "content-type": "application/json" } }));
  const body = (await response.json()) as { result?: unknown };
  return { status: response.status, result: body.result };
}
`;

function expectCase(name: string, example: Example): string {
  return `
test(${lit(name)}, async () => {
  const { status, result } = await call(${lit(example.input)});
  assert.equal(status, 200);
  assert.deepEqual(result, ${lit(example.output)});
});
`;
}

export type TestStyle = "good" | "vacuous" | "weak";

export function tests(item: BenchItem, style: TestStyle): string {
  const ac2 = `AC2: ${item.edge.text}`;
  const second =
    style === "good"
      ? expectCase(ac2, item.edge)
      : style === "weak"
        ? expectCase(ac2, item.weak)
        : `
test(${lit(ac2)}, () => {
  assert.deepEqual(${lit(item.edge.output)}, ${lit(item.edge.output)});
});
`;
  return `${CALL(item.id, "../../")}${expectCase(`AC1: ${item.normal.text}`, item.normal)}${second}
test("AC3: a value that is not a string is rejected with 400", async () => {
  const { status } = await call(42);
  assert.equal(status, 400);
});
`;
}

export function flow(item: BenchItem): string {
  return `import type { Flow } from "../../shared/flow.ts";

export const flow: Flow = {
  feature: ${lit(item.id)},
  steps: [
    {
      name: ${lit(`AC1: ${item.normal.text}`)},
      request: { method: "POST", path: ${lit(`/${item.id}`)}, body: { value: ${lit(item.normal.input)} } },
      expect: ({ status, body }) => (status === 200 && JSON.stringify((body as { result?: unknown }).result) === ${lit(lit(item.normal.output))} ? null : \`unexpected \${status} \${JSON.stringify(body)}\`),
    },
  ],
};
`;
}

export function monitor(item: BenchItem): string {
  const cases = [item.normal, item.edge, ...item.hidden].map((example, i) => expectCase(`monitor ${item.id} #${i + 1}: ${lit(example.input)}`, example)).join("");
  return `${CALL(item.id, "../")}${cases}`;
}
