import { handle } from "./app.ts";
import type { Env } from "./env.ts";

export default { fetch: handle } satisfies ExportedHandler<Env>;
