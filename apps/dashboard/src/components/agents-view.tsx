import { createContext, useContext, useState, type ReactNode } from "react";
import { Bot, BookOpen, History, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AgentConfig, AgentsView as View, RoleSetting, RoleView, Skill } from "@chef/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RouterTab } from "@/components/router-tab";
import { StatusDot, ToneBadge } from "@/components/status";
import { agentsApi } from "@/lib/api";
import { configOf, ownRole, ownSkill, saveAgents, setAgents, settingOf, useAgents, workingRole } from "@/lib/agents";
import { ago } from "@/lib/format";
import type { SettingsScope } from "@/lib/selection";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const RUNS: Readonly<Record<RoleView["runs"], { readonly badge: string; readonly text: string }>> = {
  agent: {
    badge: "Claude Code agent",
    text: "Runs as a Claude Code agent in its own sandbox. It reads the project, runs commands and edits files, but only inside the paths below. Skills are loaded when their description fits the task.",
  },
  api: {
    badge: "Claude call",
    text: "Runs as one Claude call. It reads what chef gives it and answers; it never edits files. Its skills are added to its system prompt.",
  },
  rules: {
    badge: "Code rules",
    text: "Runs as code rules after every merge. This prompt is not sent to a model yet.",
  },
};

export type AgentSection = "agents" | "skills" | "router";

export interface AgentsNav {
  readonly go: (section: AgentSection, item: string | null, scope?: SettingsScope) => void;
}

const Nav = createContext<AgentsNav>({ go: () => {} });

function ScopeBadge({ view, own, changed }: { readonly view: View; readonly own: boolean; readonly changed: boolean }) {
  if (!view.scope) return null;
  if (own) return <ToneBadge tone="run">this project</ToneBadge>;
  return changed ? <ToneBadge tone="idle">all projects</ToneBadge> : null;
}

function SharedNote({ view, what, onEdit }: { readonly view: View; readonly what: string; readonly onEdit: () => void }) {
  if (!view.scope) return null;
  return (
    <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground" data-inherited>
      This {what} uses the setting for all projects. Saving here changes it for this project only.{" "}
      <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onEdit}>
        Edit it for all projects
      </button>
    </p>
  );
}

function Field(props: { readonly label: string; readonly hint?: ReactNode; readonly children: ReactNode }) {
  return (
    <label className="grid content-start gap-1.5 text-sm">
      <span className="font-medium">{props.label}</span>
      {props.children}
      {props.hint ? <span className="text-xs text-muted-foreground">{props.hint}</span> : null}
    </label>
  );
}

function Pane(props: { readonly list: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 md:grid-cols-[17rem_1fr]">
      <nav className="flex flex-col gap-0.5 overflow-y-auto border-b p-2 max-md:max-h-56 md:border-r md:border-b-0">{props.list}</nav>
      <div className="min-h-0 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6">{props.children}</div>
      </div>
    </div>
  );
}

function ListItem(props: { readonly selected: boolean; readonly onClick: () => void; readonly title: string; readonly sub: ReactNode; readonly badge?: ReactNode; readonly id: string; readonly kind: string }) {
  return (
    <button type="button" onClick={props.onClick} {...{ [`data-${props.kind}`]: props.id }} aria-current={props.selected ? "true" : undefined} className={cn("flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted", props.selected && "bg-muted")}>
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <span className="min-w-0 flex-1 truncate">{props.title}</span>
        {props.badge}
      </span>
      <span className="truncate text-xs text-muted-foreground">{props.sub}</span>
    </button>
  );
}

function RoleList({ view, selected, pick }: { readonly view: View; readonly selected: string; readonly pick: (item: string) => void }) {
  const { sessions } = useWorkspace();
  const shared = view.skills.filter((s) => s.everyone).length;
  return (
    <>
      {view.roles.map((r) => {
        const busy = sessions.filter((s) => workingRole(s) === r.role).length;
        const count = r.runs === "rules" ? 0 : r.skills.length + shared;
        return (
          <ListItem
            key={r.role}
            id={r.role}
            kind="role"
            selected={selected === r.role}
            onClick={() => pick(r.role)}
            title={r.label}
            sub={
              <>
                {RUNS[r.runs].badge}
                {r.runs === "rules" ? "" : ` · ${r.model ?? r.defaultModel}`}
                {count ? ` · ${count} ${count === 1 ? "skill" : "skills"}` : ""}
              </>
            }
            badge={
              <>
                {busy ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-normal text-run" title={`Working on ${busy} ${busy === 1 ? "build" : "builds"} now`}>
                    <StatusDot tone="run" />
                    {busy}
                  </span>
                ) : null}
                {view.scope ? <ScopeBadge view={view} own={ownRole(view, r.role)} changed={r.custom || r.edited} /> : r.custom ? <ToneBadge tone="idle">yours</ToneBadge> : r.edited ? <ToneBadge tone="run">edited</ToneBadge> : null}
              </>
            }
          />
        );
      })}
      <Button variant="ghost" size="sm" className="mt-1 justify-start text-muted-foreground" onClick={() => pick("new")}>
        <Plus />
        Add a role
      </Button>
    </>
  );
}

function SkillPicker({ skills, value, onChange }: { readonly skills: readonly Skill[]; readonly value: readonly string[]; readonly onChange: (next: string[]) => void }) {
  const { go } = useContext(Nav);
  if (skills.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        No skills yet.{" "}
        <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => go("skills", "new")}>
          Write the first one
        </button>
        .
      </p>
    );
  const ordered = [...skills.filter((s) => s.everyone), ...skills.filter((s) => !s.everyone)];
  return (
    <div className="flex flex-col gap-1" role="group" aria-label="Skills">
      {ordered.map((s) => (
        <label key={s.name} data-skill-option={s.name} data-shared={s.everyone || undefined} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2", s.everyone ? "bg-muted/40" : "cursor-pointer hover:bg-muted/50")}>
          <input type="checkbox" className="mt-0.5 size-4 accent-foreground" checked={s.everyone || value.includes(s.name)} disabled={s.everyone} onChange={(e) => onChange(e.target.checked ? [...value, s.name] : value.filter((n) => n !== s.name))} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs">{s.name}</span>
              {s.everyone ? <span className="text-[11px] text-muted-foreground">for every role</span> : null}
            </span>
            <span className="block text-xs text-muted-foreground">{s.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

const BLANK: RoleSetting = {
  label: "",
  description: "",
  instructions: "Implement the feature inside `features/{feature}/` so its locked tests pass. Import other code only from `shared/`. Do not write comments.",
  model: null,
  skills: [],
};

function RoleEditor({ view, role }: { readonly view: View; readonly role: RoleView | null }) {
  const { sessions, openSession, features } = useWorkspace();
  const { go } = useContext(Nav);
  const select = ({ item }: { readonly item: string }) => go("agents", item || null);
  const own = role ? ownRole(view, role.role) : true;
  const sharedRole = role !== null && view.scope !== undefined && (!role.custom || view.scope.shared.roles.includes(role.role));
  const [draft, setDraft] = useState<RoleSetting>(role ? settingOf(role) : BLANK);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const base = role ? settingOf(role) : BLANK;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base) || (!role && id.length > 0);
  const change = (patch: Partial<RoleSetting>) => setDraft((d) => ({ ...d, ...patch }));
  const working = role ? sessions.filter((s) => workingRole(s) === role.role) : [];
  const run = async (config: AgentConfig, summary: string, after?: string) => {
    setBusy(true);
    const ok = await saveAgents(view, config, summary);
    setBusy(false);
    if (ok && after !== undefined) select({ item: after });
  };
  const save = () => {
    const key = role?.role ?? id.trim();
    const current = configOf(view);
    void run(
      {
        ...current,
        roles: {
          ...current.roles,
          [key]: { ...draft, model: draft.model?.trim() || null },
        },
      },
      role ? `Edited ${draft.label}` : `Added ${draft.label}`,
      key,
    );
  };
  const remove = () => {
    if (!role) return;
    const current = configOf(view);
    const roles = Object.fromEntries(Object.entries(current.roles).filter(([key]) => key !== role.role));
    void run({ ...current, roles }, view.scope && sharedRole ? `${role.label} uses the setting for all projects` : role.custom ? `Removed ${role.label}` : `Reset ${role.label} to default`, role.custom && !sharedRole ? "" : role.role);
  };
  const runs = RUNS[role?.runs ?? "agent"];
  return (
    <form
      className="flex flex-col gap-5"
      data-role-editor={role?.role ?? "new"}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{role ? role.label : "New role"}</h2>
        {role ? <span className="font-mono text-xs text-muted-foreground">{role.role}</span> : null}
        <ToneBadge tone="idle">{runs.badge}</ToneBadge>
        <span className="flex-1" />
        {view.scope && role && own && sharedRole ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
            <RotateCcw />
            Use the setting for all projects
          </Button>
        ) : null}
        {!view.scope && role && !role.custom && role.edited ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
            <RotateCcw />
            Reset to default
          </Button>
        ) : null}
        {role?.custom && own && !sharedRole ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
            <Trash2 />
            Remove role
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{runs.text}</p>
      {role && !own ? <SharedNote view={view} what="role" onEdit={() => go("agents", role.role, "app")} /> : null}
      {working.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-sm" data-working-now>
          <span className="text-muted-foreground">Working now on</span>
          {working.map((s) => (
            <button key={s.id} type="button" onClick={() => openSession(s.id)} className="inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs hover:bg-muted">
              <StatusDot tone="run" />
              {features.find((f) => f.id === s.featureId)?.title ?? s.featureId}
            </button>
          ))}
        </div>
      ) : null}
      {role ? null : (
        <Field label="Role id" hint="Lower case letters and dashes, for example data-modeler. It cannot change later.">
          <Input value={id} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder="data-modeler" aria-label="Role id" pattern="[a-z][a-z-]{1,39}" required />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={draft.label} onChange={(e) => change({ label: e.target.value })} aria-label="Name" required />
        </Field>
        {role?.runs === "rules" ? null : (
          <Field label="Model" hint={`Empty uses ${role?.defaultModel ?? view.roles.find((r) => r.role === "backend")?.defaultModel ?? "the coder model"} from Settings.`}>
            <Input value={draft.model ?? ""} onChange={(e) => change({ model: e.target.value || null })} placeholder={role?.defaultModel ?? "Default coder model"} aria-label="Model" />
          </Field>
        )}
      </div>
      <Field label="What it does" hint={role?.plannable || !role ? "The planner reads this to decide which role builds each step." : undefined}>
        <Input value={draft.description} onChange={(e) => change({ description: e.target.value })} aria-label="What it does" required />
      </Field>
      <Field label="System prompt" hint="{feature} is replaced with the feature id.">
        <Textarea value={draft.instructions} onChange={(e) => change({ instructions: e.target.value })} aria-label="System prompt" className="max-h-[55vh] min-h-40 overflow-y-auto font-mono text-xs leading-relaxed md:text-xs" required />
      </Field>
      {role?.runs === "rules" ? null : (
        <div className="grid gap-1.5 text-sm">
          <span className="font-medium">Skills</span>
          <SkillPicker skills={view.skills} value={draft.skills} onChange={(skills) => change({ skills })} />
          <span className="text-xs text-muted-foreground">Skills marked for every role come from Skills. Tick others to give this role its own.</span>
        </div>
      )}
      {role?.runs === "agent" || !role ? (
        <div className="grid gap-1.5 text-sm">
          <span className="font-medium">May change</span>
          <ul className="flex flex-col gap-0.5 rounded-lg bg-muted px-3 py-2 font-mono text-xs">
            {(role?.writeScope ?? ["features/{feature}/**", "!features/{feature}/**/*.test.ts", "!features/{feature}/flow.ts", "src/registry.gen.ts"]).map((p) => (
              <li key={p}>{p}</li>
            ))}
            {role?.writeScope.length === 0 ? <li>nothing</li> : null}
          </ul>
          <span className="text-xs text-muted-foreground">chef's checks reject any change outside these paths, whatever the prompt says.</span>
        </div>
      ) : null}
      <div className="sticky bottom-0 -mx-1 flex items-center gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
        <span className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : view.scope ? (own ? "Saved for this project. History can bring back any earlier version." : "Using the setting for all projects.") : role?.edited ? "Saved. History can bring back any earlier version." : "Using chef's default."}</span>
        <span className="flex-1" />
        {dirty ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(base)}>
            Discard
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={busy || !dirty}>
          Save
        </Button>
      </div>
    </form>
  );
}

function usedByText(count: number): string {
  if (count === 0) return "Not used yet";
  return `Used by ${count} ${count === 1 ? "role" : "roles"}`;
}

function SkillList({ view, selected, pick }: { readonly view: View; readonly selected: string; readonly pick: (item: string) => void }) {
  return (
    <>
      {view.skills.map((s) => (
        <ListItem key={s.name} id={s.name} kind="skill" selected={selected === s.name} onClick={() => pick(s.name)} title={s.name} sub={s.everyone ? "Every role" : usedByText(view.roles.filter((r) => r.skills.includes(s.name)).length)} badge={<ScopeBadge view={view} own={ownSkill(view, s.name)} changed />} />
      ))}
      <Button variant="ghost" size="sm" className="mt-1 justify-start text-muted-foreground" onClick={() => pick("new")}>
        <Plus />
        New skill
      </Button>
    </>
  );
}

function SkillEditor({ view, skill }: { readonly view: View; readonly skill: Skill | null }) {
  const { go } = useContext(Nav);
  const select = ({ item }: { readonly item: string }) => go("skills", item || null);
  const own = skill ? ownSkill(view, skill.name) : true;
  const shared = skill !== null && view.scope !== undefined && view.scope.shared.skills.includes(skill.name);
  const blank: Skill = { name: "", description: "", body: "", everyone: false };
  const [draft, setDraft] = useState<Skill>(skill ?? blank);
  const usedBy = (name: string) => view.roles.filter((r) => r.skills.includes(name)).map((r) => r.role);
  const [roles, setRoles] = useState<string[]>(skill ? usedBy(skill.name) : []);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(skill ?? blank) || JSON.stringify([...roles].sort()) !== JSON.stringify(skill ? usedBy(skill.name).sort() : []);
  const write = async (next: AgentConfig, summary: string, item: string) => {
    setBusy(true);
    const ok = await saveAgents(view, next, summary);
    setBusy(false);
    if (ok) select({ item });
  };
  const withRoles = (name: string, keep: (role: RoleView) => boolean, skills: Skill[]): AgentConfig => {
    const current = configOf(view);
    const next: Record<string, RoleSetting> = { ...current.roles };
    for (const r of view.roles) {
      const has = r.skills.includes(name);
      const want = keep(r);
      if (has === want) continue;
      const setting = next[r.role] ?? settingOf(r);
      next[r.role] = {
        ...setting,
        skills: want ? [...setting.skills.filter((n) => n !== name), name] : setting.skills.filter((n) => n !== name),
      };
    }
    return { ...current, roles: next, skills };
  };
  const save = () => {
    const name = draft.name.trim();
    const mine = configOf(view).skills;
    const unchanged = skill !== null && JSON.stringify(draft) === JSON.stringify(skill);
    const skills = mine.some((s) => s.name === name) ? mine.map((s) => (s.name === name ? { ...draft, name } : s)) : !own && unchanged ? mine : [...mine, { ...draft, name }];
    void write(
      withRoles(name, (r) => !draft.everyone && roles.includes(r.role), skills),
      skill ? `Edited skill ${name}` : `Added skill ${name}`,
      name,
    );
  };
  const remove = () => {
    if (!skill) return;
    if (shared) {
      const current = configOf(view);
      void write({ ...current, skills: current.skills.filter((s) => s.name !== skill.name) }, `${skill.name} uses the version for all projects`, skill.name);
      return;
    }
    void write(
      withRoles(
        skill.name,
        () => false,
        view.skills.filter((s) => s.name !== skill.name),
      ),
      `Removed skill ${skill.name}`,
      "",
    );
  };
  return (
    <form
      className="flex flex-col gap-5"
      data-skill-editor={skill?.name ?? "new"}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex items-center gap-2">
        <BookOpen className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{skill ? skill.name : "New skill"}</h2>
        <span className="flex-1" />
        {skill && own ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
            {shared ? <RotateCcw /> : <Trash2 />}
            {shared ? "Use the version for all projects" : "Remove skill"}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">A skill is a short guide a role can follow, like a house style, a library's quirks or a checklist. Give it to every role to use it in all sessions, or only to the roles that need it. Coding roles load it when its description fits the task; planner and reviewer always read it.</p>
      {skill && !own ? <SharedNote view={view} what="skill" onEdit={() => go("skills", skill.name, "app")} /> : null}
      {skill ? null : (
        <Field label="Name" hint="Lower case letters, digits and dashes, for example tidy-sql.">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase() })} placeholder="tidy-sql" aria-label="Skill name" pattern="[a-z][a-z0-9-]{0,63}" required />
        </Field>
      )}
      <Field label="When to use it" hint="Roles decide to load the skill from this line.">
        <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Use when writing SQL queries" aria-label="When to use it" required />
      </Field>
      <Field label="Instructions" hint="Markdown. Keep it short and concrete.">
        <Textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Instructions" className="max-h-[55vh] min-h-48 overflow-y-auto font-mono text-xs leading-relaxed md:text-xs" required />
      </Field>
      <div className="grid gap-1.5 text-sm">
        <span className="font-medium">Who uses it</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Who uses it">
          {(
            [
              [true, "Every role", view.scope ? "All roles in every session of this project" : "All roles in every session of every project"],
              [false, "Chosen roles", "Only the roles you tick below"],
            ] as const
          ).map(([everyone, label, hint]) => (
            <label key={label} title={hint} className={cn("inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs", draft.everyone === everyone && "border-foreground/40 bg-muted font-medium")}>
              <input type="radio" name="skill-scope" className="size-3.5 accent-foreground" checked={draft.everyone === everyone} onChange={() => setDraft({ ...draft, everyone })} />
              {label}
            </label>
          ))}
        </div>
      </div>
      {draft.everyone ? (
        <p className="-mt-3 text-xs text-muted-foreground">Every role gets this skill in every session, including roles you add later.</p>
      ) : (
        <div className="grid gap-1.5 text-sm">
          <span className="font-medium">Roles that use it</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Roles that use it">
            {view.roles
              .filter((r) => r.runs !== "rules")
              .map((r) => (
                <label key={r.role} className={cn("inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs", roles.includes(r.role) && "border-foreground/40 bg-muted font-medium")}>
                  <input type="checkbox" className="size-3.5 accent-foreground" checked={roles.includes(r.role)} onChange={(e) => setRoles(e.target.checked ? [...roles, r.role] : roles.filter((n) => n !== r.role))} />
                  {r.label}
                </label>
              ))}
          </div>
        </div>
      )}
      <div className="sticky bottom-0 -mx-1 flex items-center gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
        <span className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : view.scope && !own ? "Using the version for all projects" : view.scope ? "Saved for this project" : "Saved"}</span>
        <span className="flex-1" />
        <Button type="submit" size="sm" disabled={busy || !dirty}>
          Save
        </Button>
      </div>
    </form>
  );
}

function HistoryMenu({ view }: { readonly view: View }) {
  const restore = async (version: number) => {
    try {
      setAgents(await agentsApi(view.scope?.project ?? null).restore(version));
      toast.success(version === 0 ? (view.scope ? "Back to the settings for all projects" : "Back to chef's defaults") : `Restored version ${version}`, { description: "The version you left is still in History." });
    } catch (error) {
      toast.error("Could not restore", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="History">
          <History />
          <span className="max-sm:hidden">{view.version ? `Version ${view.version}` : view.scope ? "No changes" : "Defaults"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Every save is kept. Pick one to bring it back.</DropdownMenuLabel>
        {view.history.map((v) => (
          <DropdownMenuItem key={v.version} disabled={v.version === view.version} onClick={() => void restore(v.version)} data-version={v.version}>
            <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">v{v.version}</span>
            <span className="min-w-0 flex-1 truncate">{v.summary}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{v.version === view.version ? "current" : ago(v.at)}</span>
          </DropdownMenuItem>
        ))}
        {view.history.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem disabled={view.version === 0} onClick={() => void restore(0)}>
          <RotateCcw />
          {view.scope ? "Back to the settings for all projects" : "Back to chef's defaults"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const INTRO: Readonly<Record<AgentSection, { readonly app: string; readonly project: string }>> = {
  agents: { app: "Every project starts with these roles. A project can change any of them for itself.", project: "The roles that plan, test, build and review this project. Change one here to change it for this project only." },
  skills: { app: "Short guides roles follow in every project.", project: "Skills from all projects, plus this project's own. A skill with the same name here replaces the shared one." },
  router: { app: "How chef decides whether a request is a new feature, a change, a chore or a question, in every project.", project: "How chef sorts requests in this project. It follows the setting for all projects until you save a change here." },
};

export function AgentsSection(props: { readonly project: string | null; readonly section: AgentSection; readonly item: string | null; readonly nav: AgentsNav; readonly before?: ReactNode }) {
  const { section, item, nav } = props;
  const view = useAgents(props.project);
  const pick = (next: string) => nav.go(section, next);
  if (!view) return <div className="grid h-full place-items-center text-muted-foreground">Loading</div>;
  const roleId = item && (item === "new" || view.roles.some((r) => r.role === item)) ? item : (view.roles[0]?.role ?? "new");
  const role = view.roles.find((r) => r.role === roleId) ?? null;
  const skillId = item && (item === "new" || view.skills.some((s) => s.name === item)) ? item : (view.skills[0]?.name ?? "new");
  const skill = view.skills.find((s) => s.name === skillId) ?? null;
  return (
    <Nav.Provider value={nav}>
      <div className="flex h-full min-h-0 flex-col" data-view="agents" data-scope={view.scope ? "project" : "app"}>
        <div className="flex shrink-0 items-center gap-2.5 border-b px-4 py-2 sm:px-6">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">{INTRO[section][view.scope ? "project" : "app"]}</span>
          <HistoryMenu view={view} />
        </div>
        {section === "agents" ? (
          <Pane list={<RoleList view={view} selected={roleId} pick={pick} />}>
            <RoleEditor key={`${roleId}:${view.version}`} view={view} role={role} />
          </Pane>
        ) : section === "skills" ? (
          <Pane list={<SkillList view={view} selected={skillId} pick={pick} />}>
            <SkillEditor key={`${skillId}:${view.version}`} view={view} skill={skill} />
          </Pane>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {props.before}
            <RouterTab key={view.version} view={view} />
          </div>
        )}
      </div>
    </Nav.Provider>
  );
}
