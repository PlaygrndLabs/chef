import { handle } from "./app.ts";
import type { Env } from "./env.ts";

export { Backoffice } from "./backoffice.ts";
export { Members } from "./directory.ts";
export { Member } from "./member.ts";
export { Organization } from "./organization.ts";

export default { fetch: handle } satisfies ExportedHandler<Env>;
