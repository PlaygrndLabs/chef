import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Plus, RotateCcw, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { designChanges, designRequest, draftOf, type CatalogFont, type DesignDraft, type DesignView } from "@chef/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MainApp } from "@/components/session-sections";
import { host as chefHost } from "@/host";
import { COLOR_NAME, colorOf, contrastChecks, familyOf, hexOf, lookMessage, previewFont, RADIUS, schemesOf, WIDTHS, withColor, withFont, withMaterial, type PreviewFont, type Scheme } from "@/lib/design-draft";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const useProjectLevel = chefHost.useProjectLevel ?? (() => null);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const KIT_COLORS = ["bg", "fg", "card", "muted", "muted-bg", "border", "input", "ring", "primary", "primary-fg", "accent", "danger", "success", "warning", "info"] as const;

const COLOR_HINTS: Readonly<Record<string, string>> = {
  bg: "Page",
  fg: "Text",
  card: "Cards",
  muted: "Quiet text",
  "muted-bg": "Quiet surfaces",
  border: "Lines",
  input: "Field borders",
  ring: "Focus ring",
  primary: "Main buttons",
  "primary-fg": "Text on main buttons",
  accent: "Highlights",
  danger: "Errors",
  success: "Done",
  warning: "Warnings",
  info: "Notes",
};

const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(?:rgb|hsl|oklch)\([0-9.,%\s/a-z-]+\))$/;
const KIT = "kit";
const KINDS: readonly { readonly kind: CatalogFont["kind"]; readonly label: string }[] = [
  { kind: "sans", label: "Sans" },
  { kind: "serif", label: "Serif" },
  { kind: "condensed", label: "Condensed" },
  { kind: "mono", label: "Mono" },
];

function Fieldset({ legend, note, children }: { readonly legend: string; readonly note?: string | undefined; readonly children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-2.5 border-b pb-4 last:border-b-0">
      <legend className="kicker mb-2.5">{legend}</legend>
      {note ? <p className="-mt-1 text-xs text-muted-foreground">{note}</p> : null}
      {children}
    </fieldset>
  );
}

function FontPicker({ role, label, value, catalog, families, disabled, onChange, onOpen }: { readonly role: string; readonly label: string; readonly value: string | undefined; readonly catalog: readonly CatalogFont[]; readonly families: Readonly<Record<string, string>>; readonly disabled: boolean; readonly onChange: (name: string | null) => void; readonly onOpen: () => void }) {
  const id = useId();
  const family = value ? families[value] : undefined;
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <Select value={value ?? KIT} onValueChange={(next) => onChange(next === KIT ? null : next)} onOpenChange={(open) => open && onOpen()} disabled={disabled}>
        <SelectTrigger id={id} className="w-full" data-font-role={role} style={family ? { fontFamily: `"${family}"` } : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={KIT}>The kit's own</SelectItem>
          {KINDS.map(({ kind, label: kindLabel }) => {
            const fonts = catalog.filter((font) => font.kind === kind);
            if (!fonts.length) return null;
            return (
              <SelectGroup key={kind}>
                <SelectLabel>{kindLabel}</SelectLabel>
                {fonts.map((font) => (
                  <SelectItem key={font.name} value={font.name} style={families[font.name] ? { fontFamily: `"${families[font.name]}"` } : undefined}>
                    {font.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

function ColorRow({ name, scheme, value, own, disabled, onChange }: { readonly name: string; readonly scheme: Scheme; readonly value: string | null; readonly own: boolean; readonly disabled: boolean; readonly onChange: (value: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const valid = COLOR.test(text.trim());
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)_6.5rem] items-center gap-2" data-color={name}>
      <input
        type="color"
        value={hexOf(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`Pick ${name}, ${scheme}`}
        className="size-8 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="grid min-w-0">
        <span className="truncate text-sm">{name}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {COLOR_HINTS[name] ?? "Brand color"}
          {own ? "" : ", kit's own"}
        </span>
      </label>
      <Input
        id={id}
        value={text}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={!valid}
        onChange={(event) => {
          setText(event.target.value);
          if (COLOR.test(event.target.value.trim())) onChange(event.target.value.trim());
        }}
        onBlur={() => setText(value ?? "")}
        className="h-8 font-mono text-xs"
      />
    </li>
  );
}

function AddNamed({ label, placeholder, taken, disabled, onAdd }: { readonly label: string; readonly placeholder: string; readonly taken: readonly string[]; readonly disabled: boolean; readonly onAdd: (name: string) => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const clean = name.trim().toLowerCase();
  const problem = !clean ? null : !COLOR_NAME.test(clean) ? "Use lower-case letters, digits and dashes, starting with a letter." : taken.includes(clean) ? "That name is taken." : null;
  return (
    <form
      className="grid gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (!clean || problem) return;
        onAdd(clean);
        setName("");
      }}
    >
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} value={name} onChange={(event) => setName(event.target.value)} placeholder={placeholder} disabled={disabled} aria-invalid={problem !== null} aria-describedby={problem ? `${id}-problem` : undefined} className="h-8 text-sm" />
        <Button type="submit" size="sm" variant="outline" disabled={disabled || !clean || problem !== null}>
          <Plus /> Add
        </Button>
      </div>
      {problem ? (
        <p id={`${id}-problem`} className="text-xs text-bad">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

function MaterialRow({ name, value, colors, disabled, onChange }: { readonly name: string; readonly value: string; readonly colors: Readonly<Record<string, string>>; readonly disabled: boolean; readonly onChange: (value: string) => void }) {
  const id = useId();
  const vars = Object.fromEntries(Object.entries(colors).map(([token, color]) => [`--${token}`, color]));
  return (
    <li className="grid gap-1.5" data-material={name}>
      <span className="h-10 rounded-md border" style={{ ...vars, background: value }} aria-hidden />
      <label htmlFor={id} className="text-sm">
        {name}
      </label>
      <Textarea id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} rows={2} spellCheck={false} className="font-mono text-xs" />
    </li>
  );
}

export function DesignManager() {
  const { api, data, selection } = useWorkspace();
  const viewOnly = useProjectLevel(selection.project) === "view";
  const main = data.spec?.commitId ?? null;
  const [design, setDesign] = useState<DesignView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState<DesignDraft | null>(null);
  const [scheme, setScheme] = useState<Scheme>(() => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [fonts, setFonts] = useState<readonly PreviewFont[]>([]);
  const [families, setFamilies] = useState<Readonly<Record<string, string>>>({});
  const [supported, setSupported] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const changesRef = useRef(0);
  const savedRef = useRef<string | null>(null);
  savedRef.current = saved;

  useEffect(() => {
    let live = true;
    api.design().then(
      (next) => {
        if (!live) return;
        setDesign(next);
        setFailed(null);
        if (changesRef.current === 0 || (savedRef.current !== null && savedRef.current !== main)) {
          setDraft(draftOf(next));
          setSaved(null);
        }
      },
      (e: unknown) => live && setFailed(message(e)),
    );
    return () => {
      live = false;
    };
  }, [api, main]);

  const changes = useMemo(() => (design && draft ? designChanges(design, draft) : []), [design, draft]);
  changesRef.current = changes.length;
  const previewScheme: Scheme = draft?.scheme ?? scheme;

  const fontNames = Object.values(draft?.fonts ?? {}).join("|");
  useEffect(() => {
    let live = true;
    const names = [...new Set(fontNames.split("|").filter(Boolean))];
    void Promise.all(names.map(previewFont)).then((loaded) => live && setFonts(loaded.filter((font): font is PreviewFont => font !== null)));
    for (const name of names) void familyOf(name).then((family) => live && family && setFamilies((all) => (all[name] ? all : { ...all, [name]: family })));
    return () => {
      live = false;
    };
  }, [fontNames]);

  const loadCatalog = () => {
    for (const font of design?.catalog ?? []) {
      void previewFont(font.name).then((loaded) => loaded && setFamilies((all) => (all[font.name] ? all : { ...all, [font.name]: loaded.family })));
    }
  };

  const preview = useMemo(() => ({ message: lookMessage(changes.length && draft ? draft : null, previewScheme, changes.length ? fonts : []), onSupport: setSupported }), [changes.length, draft, previewScheme, fonts]);

  if (failed) return <p className="p-4 text-sm text-bad">Could not load the design: {failed}</p>;
  if (!design || !draft) return <p className="p-4 text-sm text-muted-foreground">Loading the design…</p>;

  const disabled = viewOnly || saved !== null;
  const colors = draft.colors[previewScheme];
  const names = [...KIT_COLORS, ...Object.keys({ ...design.colors[previewScheme], ...colors }).filter((name) => !(KIT_COLORS as readonly string[]).includes(name))];
  const checks = contrastChecks(design, draft, previewScheme);
  const effective = Object.fromEntries(names.flatMap((name) => {
    const value = colorOf(design, draft, previewScheme, name);
    return value ? [[name, value]] : [];
  }));
  const save = async () => {
    const request = designRequest(changes);
    if (!request) return;
    try {
      await api.prompt(request);
      setSaved(main);
      toast.success("Chef is saving the design", { description: "It writes the changes into the look and checks them. Main's app shows them once they are merged." });
    } catch (e) {
      toast.error("Could not save the design", { description: message(e) });
    }
  };

  return (
    <div className="@container flex min-h-0 flex-1 flex-col" data-design-manager>
      <div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
        <section aria-labelledby="design-manager-title" className="flex max-h-[50%] min-h-0 shrink-0 flex-col border-b @2xl:max-h-none @2xl:w-72 @2xl:border-r @2xl:border-b-0 @5xl:w-[22rem]">
          <div className="grid gap-1 px-4 pt-4 pb-3">
            <h2 id="design-manager-title" className="text-sm font-medium">
              Design system
            </h2>
            <p className="text-xs text-muted-foreground">Every change shows on main's app right away. Save sends the changes to Chef, which writes them into the look and checks them before merging.</p>
            {supported === false ? (
              <p className="flex gap-1.5 text-xs text-warn" role="note">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                This app was made before live preview, so it shows the changes once they are saved.
              </p>
            ) : null}
            {design.unread.length ? (
              <p className="text-xs text-muted-foreground" role="note">
                Some looks are written in a way this page cannot read ({design.unread.join(", ")}), so their values are not shown here.
              </p>
            ) : null}
          </div>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 pb-4">
            <Fieldset legend="Preview">
              <ToggleGroup type="single" variant="outline" size="sm" value={previewScheme} onValueChange={(next) => next && setScheme(next as Scheme)} disabled={draft.scheme !== null} aria-label="Preview in light or dark">
                <ToggleGroupItem value="light">Light</ToggleGroupItem>
                <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
              </ToggleGroup>
              <SchemeSelect value={draft.scheme} disabled={disabled} onChange={(next) => setDraft({ ...draft, scheme: next })} />
            </Fieldset>
            <Fieldset legend="Name">
              <NameInput value={draft.brand ?? ""} disabled={disabled} onChange={(next) => setDraft({ ...draft, brand: next.trim() ? next : null })} />
            </Fieldset>
            <Fieldset legend="Fonts">
              {(
                [
                  ["display", "Headings"],
                  ["body", "Text"],
                  ["mono", "Code"],
                ] as const
              ).map(([role, label]) => (
                <FontPicker key={role} role={role} label={label} value={draft.fonts[role]} catalog={design.catalog} families={families} disabled={disabled || !design.catalog.length} onChange={(name) => setDraft(withFont(draft, role, name))} onOpen={loadCatalog} />
              ))}
            </Fieldset>
            <Fieldset legend={`Colors, ${previewScheme}`} note={draft.scheme ? undefined : "Switch the preview to edit the other scheme's colors."}>
              <ul className="grid gap-2">
                {names.map((name) => (
                  <ColorRow key={`${previewScheme}:${name}`} name={name} scheme={previewScheme} value={colorOf(design, draft, previewScheme, name)} own={colors[name] !== undefined} disabled={disabled} onChange={(value) => setDraft(withColor(draft, previewScheme, name, value))} />
                ))}
              </ul>
              <AddNamed
                label="Add a brand color"
                placeholder="leaf"
                taken={names}
                disabled={disabled}
                onAdd={(name) => {
                  const value = colorOf(design, draft, previewScheme, "accent") ?? "#4f46e5";
                  setDraft(schemesOf(draft).reduce((next, s) => withColor(next, s, name, colorOf(design, draft, s, "accent") ?? value), draft));
                }}
              />
            </Fieldset>
            <Fieldset legend="Contrast" note="Readable text needs 4.5 to 1, large accents 3 to 1.">
              <ul className="grid gap-1" aria-live="polite">
                {checks.map((check) => (
                  <li key={check.label} className="flex items-center gap-2 text-sm" data-contrast={check.ok === null ? "unknown" : check.ok ? "pass" : "fail"}>
                    {check.ok === false ? <TriangleAlert className="size-3.5 text-bad" aria-hidden /> : <Check className={cn("size-3.5", check.ok ? "text-ok" : "text-muted-foreground")} aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{check.label}</span>
                    <span className="font-mono text-xs tabular-nums">{check.ratio === null ? "n/a" : `${check.ratio}:1`}</span>
                    <span className={cn("w-10 text-right text-xs", check.ok === false ? "text-bad" : "text-muted-foreground")}>{check.ok === null ? "" : check.ok ? "Pass" : "Low"}</span>
                  </li>
                ))}
              </ul>
            </Fieldset>
            <Fieldset legend="Shape">
              <RadiusInput value={draft.radius} disabled={disabled} onChange={(next) => setDraft({ ...draft, radius: next })} />
              <div className="grid gap-1">
                <span id="design-width" className="text-xs text-muted-foreground">
                  Page width
                </span>
                <ToggleGroup type="single" variant="outline" size="sm" value={draft.width ?? "normal"} onValueChange={(next) => next && setDraft({ ...draft, width: next })} disabled={disabled} aria-labelledby="design-width" className="flex-wrap">
                  {WIDTHS.map((width) => (
                    <ToggleGroupItem key={width.value} value={width.value}>
                      {width.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </Fieldset>
            <Fieldset legend="Materials" note="Surfaces made of more than one color, like gradients. Use the colors by name, for example var(--accent).">
              {Object.keys(draft.materials).length ? (
                <ul className="grid gap-3">
                  {Object.entries(draft.materials).map(([name, value]) => (
                    <MaterialRow key={name} name={name} value={value} colors={effective} disabled={disabled} onChange={(next) => setDraft(withMaterial(draft, name, next))} />
                  ))}
                </ul>
              ) : null}
              <AddNamed label="Add a material" placeholder="hero" taken={Object.keys(draft.materials)} disabled={disabled} onAdd={(name) => setDraft(withMaterial(draft, name, "linear-gradient(135deg, var(--primary), var(--accent))"))} />
            </Fieldset>
          </div>
          <footer className="grid gap-2 border-t px-4 py-3">
            <p className="text-xs text-muted-foreground" role="status" data-design-changes={changes.length}>
              {saved !== null ? "Saved. Chef is writing the changes into the look; this page shows them once main has them." : changes.length ? `${changes.length} ${changes.length === 1 ? "change" : "changes"} not saved` : "No changes yet"}
            </p>
            {changes.length && saved === null ? (
              <ul className="grid max-h-24 gap-0.5 overflow-y-auto font-mono text-[11px] text-muted-foreground">
                {changes.map((change) => (
                  <li key={change.what} className="truncate">
                    {change.what}: {change.to ?? "removed"}
                  </li>
                ))}
              </ul>
            ) : null}
            {viewOnly ? null : (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={!changes.length || saved !== null} onClick={() => setDraft(draftOf(design))}>
                  <RotateCcw /> Discard
                </Button>
                <Button type="button" size="sm" className="flex-1" disabled={!changes.length || saved !== null} onClick={() => void save()}>
                  <Save /> Save to main
                </Button>
              </div>
            )}
          </footer>
        </section>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <MainApp preview={preview} />
        </div>
      </div>
    </div>
  );
}

function SchemeSelect({ value, disabled, onChange }: { readonly value: Scheme | null; readonly disabled: boolean; readonly onChange: (value: Scheme | null) => void }) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Color scheme
      </label>
      <Select value={value ?? "both"} onValueChange={(next) => onChange(next === "both" ? null : (next as Scheme))} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="both">Follows the visitor's setting</SelectItem>
          <SelectItem value="light">Light only</SelectItem>
          <SelectItem value="dark">Dark only</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function NameInput({ value, disabled, onChange }: { readonly value: string; readonly disabled: boolean; readonly onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        The app's name in its top bar and page titles
      </label>
      <Input id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-8" />
    </div>
  );
}

function RadiusInput({ value, disabled, onChange }: { readonly value: string | null; readonly disabled: boolean; readonly onChange: (value: string | null) => void }) {
  const id = useId();
  const rem = value && /rem$/.test(value) ? Number.parseFloat(value) : value === "0" ? 0 : 0.75;
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Corners
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="range"
          min={0}
          max={2}
          step={0.125}
          value={Number.isFinite(rem) ? rem : 0.75}
          disabled={disabled}
          aria-valuetext={value ?? "the kit's own, 0.75rem"}
          onChange={(event) => onChange(event.target.value === "0" ? "0" : `${event.target.value}rem`)}
          className="min-w-0 flex-1 accent-primary"
        />
        <Input
          value={text}
          placeholder="0.75rem"
          disabled={disabled}
          aria-label="Corners, exact size"
          aria-invalid={text !== "" && !RADIUS.test(text)}
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value === "") onChange(null);
            else if (RADIUS.test(event.target.value)) onChange(event.target.value);
          }}
          className="h-8 w-24 font-mono text-xs"
        />
      </div>
    </div>
  );
}
