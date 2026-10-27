import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { DesignView } from "@chef/core";
import { Group } from "@/components/settings-shell";
import type { ProjectApi } from "@/lib/api";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const WIDTHS: Readonly<Record<string, string>> = { narrow: "28rem", normal: "42rem", wide: "64rem", full: "the whole window" };

function Preview(props: { readonly design: DesignView; readonly scheme: "light" | "dark" }) {
  const colors = props.design.colors[props.scheme];
  const pick = (token: string, fallback: string) => colors[token] ?? fallback;
  const dark = props.scheme === "dark";
  const radius = props.design.radius ?? "0.5rem";
  return (
    <div
      className="grid gap-3 border p-4"
      data-design-preview={props.scheme}
      style={{ background: pick("bg", dark ? "#0b0b0c" : "#ffffff"), color: pick("fg", dark ? "#f4f4f5" : "#111111"), borderColor: pick("border", dark ? "#27272a" : "#e4e4e7"), borderRadius: radius }}
    >
      <span className="text-[11px] uppercase tracking-wide" style={{ color: pick("muted", dark ? "#a1a1aa" : "#71717a") }}>
        {props.scheme}
      </span>
      <strong className="text-xl leading-tight">{props.design.brand ?? "Your app"}</strong>
      {props.design.description ? <span className="text-xs">{props.design.description}</span> : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-3 py-1.5 text-xs font-medium" style={{ background: pick("primary", dark ? "#f4f4f5" : "#111111"), color: pick("primary-fg", dark ? "#111111" : "#ffffff"), borderRadius: radius }}>
          {props.design.gate ?? "Get started"}
        </span>
        <span className="border px-3 py-1.5 text-xs" style={{ background: pick("card", "transparent"), borderColor: pick("border", dark ? "#27272a" : "#e4e4e7"), borderRadius: radius }}>
          A card
        </span>
        {colors["accent"] || props.design.accent ? <span className="size-5" style={{ background: colors["accent"] ?? props.design.accent ?? "", borderRadius: radius }} title="accent" /> : null}
      </div>
    </div>
  );
}

function variables(colors: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(colors).map(([name, value]) => [`--${name}`, value]));
}

function Swatches(props: { readonly colors: Readonly<Record<string, string>> }) {
  const entries = Object.entries(props.colors);
  if (!entries.length) return <p className="text-xs text-muted-foreground">The kit's own colors.</p>;
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
      {entries.map(([token, value]) => (
        <li key={token} className="flex min-w-0 items-center gap-2" data-color={token}>
          <span className="size-6 shrink-0 rounded border" style={{ background: value }} />
          <span className="grid min-w-0">
            <span className="truncate text-xs">{token}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{value}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Row(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{props.label}</span>
      <span className="min-w-0">{props.children}</span>
    </div>
  );
}

export function DesignSection(props: { readonly api: ProjectApi }) {
  const [design, setDesign] = useState<DesignView | null>(null);
  useEffect(() => {
    props.api.design().then(setDesign, (e: unknown) => toast.error("Could not load the design", { description: message(e) }));
  }, [props.api]);
  if (!design) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!design.sources.length) return <p className="text-sm text-muted-foreground">This project has no look yet. Chef writes one with the first page it builds; ask in the chat for the look you want, or name a site to match.</p>;
  const schemes = design.scheme ? [design.scheme] : (["light", "dark"] as const);
  const fonts = (["display", "body", "mono"] as const).filter((role) => design.fonts[role]);
  return (
    <>
      <Group title="Look" note="How the app's pages look on main. To change it, ask in the chat, for example “make it darker” or “use the fonts of linear.app”.">
        <div className="grid gap-3 sm:grid-cols-2">
          {schemes.map((scheme) => (
            <Preview key={scheme} design={design} scheme={scheme} />
          ))}
        </div>
        <div className="grid gap-1.5">
          <Row label="Fonts">{fonts.length ? fonts.map((role) => `${design.fonts[role]} (${role})`).join(", ") : "The kit's own fonts"}</Row>
          <Row label="Scheme">{design.scheme ? `${design.scheme} only` : "Follows the visitor's setting"}</Row>
          <Row label="Corners">{design.radius ?? "The kit's own"}</Row>
          {design.width ? <Row label="Width">{WIDTHS[design.width] ?? design.width}</Row> : null}
          {design.gate ? <Row label="Gate">Visitors press “{design.gate}” first</Row> : null}
        </div>
      </Group>
      {schemes.map((scheme) => (
        <Group key={scheme} title={schemes.length > 1 ? `Colors, ${scheme}` : "Colors"}>
          <Swatches colors={design.colors[scheme]} />
        </Group>
      ))}
      {Object.keys(design.materials).length ? (
        <Group title="Materials" note="Surfaces made of more than one color: gradients, glass, grain or image fills.">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
            {Object.entries(design.materials).map(([name, value]) => (
              <li key={name} className="grid min-w-0 gap-1" data-material={name}>
                <span className="h-14 rounded border" style={{ ...variables(design.colors[schemes[0] ?? "light"]), background: value }} />
                <span className="truncate text-xs">{name}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground" title={value}>
                  {value}
                </span>
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
      <Group title="References" note="Sites and images the look was matched to.">
        {design.references.length ? (
          <ul className="grid gap-1">
            {design.references.map((ref) => (
              <li key={ref}>
                <a href={ref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
                  {ref}
                  <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">None. Name a site in the chat and Chef matches its fonts, colors and shapes.</p>
        )}
      </Group>
      <Group title="Files" note="Each feature can add to the look in its own look.ts; later features keep what is there.">
        <ul className="grid gap-0.5 font-mono text-[11px] text-muted-foreground">
          {design.sources.map((path) => (
            <li key={path}>
              {path}
              {design.unread.includes(path) ? " (not shown: written in a way this page cannot read)" : ""}
            </li>
          ))}
        </ul>
      </Group>
    </>
  );
}
