export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        out += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export function matchesScope(path: string, scope: readonly string[]): boolean {
  let allowed = false;
  for (const pattern of scope) {
    if (pattern.startsWith("!")) {
      if (globToRegExp(pattern.slice(1)).test(path)) return false;
    } else if (globToRegExp(pattern).test(path)) allowed = true;
  }
  return allowed;
}
