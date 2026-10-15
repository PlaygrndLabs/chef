export const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"] as const;

export const COMPOSE_PROMPT =
  "Add a compose.yaml at the root of the code that runs this project's whole stack with Docker: every service it needs (database, cache, workers and so on), built from the code or from official images, with the app's web page served in development mode on a published port, so Chef can run the app of every branch.";

export const COMPOSE_SUGGESTION = {
  title: "Dockerize the project",
  why: "Chef runs each branch's whole stack from a compose file, and this project has none yet, so its app can't be opened here.",
  prompt: COMPOSE_PROMPT,
} as const;

export function hasComposeFile(tree: Readonly<Record<string, unknown>>): boolean {
  return COMPOSE_FILES.some((name) => name in tree);
}
