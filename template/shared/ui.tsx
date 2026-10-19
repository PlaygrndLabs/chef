import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { ICONS, type IconName } from "./theme.ts";

export type { IconName } from "./theme.ts";
export { Link, navigate, useLocation } from "./router.tsx";

export function Icon({ name, label, className }: { readonly name: IconName; readonly label?: string; readonly className?: string }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return <svg {...a11y} className={className ? `icon ${className}` : "icon"} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}

const FALLBACK = "Something went wrong. Try again.";

export function message(error: unknown, fallback = FALLBACK): string {
  const value = error !== null && typeof error === "object" && "message" in error ? (error as { message: unknown }).message : error;
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || fallback;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(text: string, status: number, body: unknown) {
    super(text);
    this.status = status;
    this.body = body;
  }
}

export interface ApiOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

function parsed(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === "string" || options.body instanceof FormData) body = options.body;
    else {
      body = JSON.stringify(options.body);
      headers["content-type"] = "application/json";
    }
  }
  let response: Response;
  try {
    response = await fetch(path, { method: options.method ?? (body === undefined ? "GET" : "POST"), headers, ...(body === undefined ? {} : { body }) });
  } catch {
    throw new ApiError("Could not reach the app. Check your connection and try again.", 0, null);
  }
  const text = await response.text();
  const data = parsed(text);
  if (response.ok) return (data === null && text ? text : data) as T;
  const said = data !== null && typeof data === "object" ? ((data as Record<string, unknown>)["error"] ?? (data as Record<string, unknown>)["message"]) : "";
  let reason = typeof said === "string" ? said : said ? JSON.stringify(said) : "";
  if (!reason && text && !/^\s*</.test(text)) reason = text.slice(0, 200);
  throw new ApiError(message(reason, `The request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""}). Try again.`), response.status, data);
}

export function toast(text: unknown, tone?: "danger"): void {
  let root = document.querySelector(".ui-toasts");
  if (!root) {
    root = document.createElement("div");
    root.className = "ui-toasts";
    root.setAttribute("aria-live", "polite");
    document.body.appendChild(root);
  }
  const item = document.createElement("div");
  item.className = tone ? `ui-toast ${tone}` : "ui-toast";
  item.innerHTML = `<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[tone === "danger" ? "alert" : "check-circle"]}</svg>`;
  item.appendChild(document.createTextNode(message(text, tone === "danger" ? FALLBACK : "Done")));
  root.appendChild(item);
  setTimeout(() => item.remove(), 3200);
}

export function ErrorText({ error }: { readonly error: unknown }) {
  if (error === null || error === undefined || error === false) return null;
  return (
    <div className="alert alert-danger" role="alert">
      <Icon name="alert" />
      <span>{message(error)}</span>
    </div>
  );
}

export interface Loaded<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  reload(): Promise<void>;
}

export function useLoad<T>(load: () => Promise<T>, deps: DependencyList = []): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(load);
  latest.current = load;
  const run = useRef(0);
  const reload = useCallback(async () => {
    const id = ++run.current;
    setLoading(true);
    try {
      const value = await latest.current();
      if (id !== run.current) return;
      setData(value);
      setError(null);
    } catch (problem) {
      if (id === run.current) setError(problem);
    } finally {
      if (id === run.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, deps);
  return { data, error, loading, reload };
}
