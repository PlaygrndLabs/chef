export const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"] as const;

export const WRANGLER_FILES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"] as const;

export const WORKER_PORT = 8787;

export const COMPOSE_TASK = "Dockerize the project";

export const COMPOSE_PROMPT = `/chore ${COMPOSE_TASK}`;

export const COMPOSE_SUGGESTION = {
  title: "Dockerize the project",
  why: "Chef runs a Cloudflare Workers project with wrangler and any other stack from a compose file, and this project has neither yet, so its app can't be opened here.",
  prompt: COMPOSE_PROMPT,
} as const;

export const COMPOSE_GUIDANCE = [
  "# How Chef runs the app",
  `A Cloudflare Workers project (a wrangler config such as \`wrangler.jsonc\` at the root of the code, and no compose file) runs in each branch's sandbox with \`wrangler dev\` on port ${WORKER_PORT}, with no Docker: Chef installs its packages, writes the project's keys to \`.dev.vars\` and runs the wrangler config's build command first. Keep such a project on Workers, Durable Objects and the other Cloudflare bindings \`wrangler dev\` runs locally, and never add a Dockerfile or compose file to it.`,
  "Any other stack runs from the compose file at the root of the code (`compose.yaml`) with `docker compose up --build`. To dockerize a project is to add that file. Whenever you add or change it:",
  "- Include every service the app needs (database, cache, workers and so on), built from the code or from official images.",
  "- Serve the app's web page in development mode on a published port. Chef opens the port in a service's `chef.port` label, otherwise the first published port, and waits for it to answer at `/`.",
  "- Add the Dockerfile every `build:` service builds from in the same change, so the stack starts from a clean checkout.",
  "- When a service needs another one (a database, a cache) ready before it starts, give that one a healthcheck and make the first wait for it with `depends_on` and `condition: service_healthy`, since a first start of a database can take a minute.",
].join("\n\n");

export function hasComposeFile(tree: Readonly<Record<string, unknown>>): boolean {
  return COMPOSE_FILES.some((name) => name in tree);
}

export function runsOnWorkers(tree: Readonly<Record<string, unknown>>): boolean {
  return !hasComposeFile(tree) && WRANGLER_FILES.some((name) => name in tree);
}

export function hasAppStack(tree: Readonly<Record<string, unknown>>): boolean {
  return hasComposeFile(tree) || runsOnWorkers(tree);
}
