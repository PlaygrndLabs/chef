import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Group } from "@/components/settings-shell";
import { LEVEL_NAME, ROLE_NAME } from "@/lib/account";
import { orgApi, sharingApi, type OrgPeople, type OrgRole, type OrgView, type ProjectAccess, type ProjectLevel } from "@/lib/api";

function Choice<T extends string>(props: { readonly value: T; readonly options: Readonly<Partial<Record<T, string>>>; readonly onChange: (next: T) => void; readonly label: string; readonly disabled?: boolean; readonly wide?: boolean }) {
  return (
    <Select value={props.value} onValueChange={(next) => props.onChange(next as T)} disabled={props.disabled === true}>
      <SelectTrigger size="sm" className={props.wide ? "w-52 shrink-0" : "w-32 shrink-0"} aria-label={props.label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(props.options) as [T, string][]).map(([value, name]) => (
          <SelectItem key={value} value={value}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

async function attempt<T>(work: () => Promise<T>, done?: string): Promise<T | null> {
  try {
    const result = await work();
    if (done) toast.success(done);
    return result;
  } catch (e) {
    toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export function MembersSection(props: { readonly org: OrgView }) {
  const [people, setPeople] = useState<OrgPeople | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [busy, setBusy] = useState(false);
  const manager = props.org.role !== "member";
  const roles: Partial<Record<OrgRole, string>> = props.org.role === "owner" ? ROLE_NAME : { admin: ROLE_NAME.admin, member: ROLE_NAME.member };
  useEffect(() => {
    orgApi.people().then(setPeople, () => setPeople({ members: [], invites: [] }));
  }, []);
  const change = async (work: () => Promise<Partial<OrgPeople>>, done?: string) => {
    setBusy(true);
    const next = await attempt(work, done);
    if (next) setPeople((current) => ({ members: next.members ?? current?.members ?? [], invites: next.invites ?? current?.invites ?? [] }));
    setBusy(false);
    return next !== null;
  };
  return (
    <Group title="Members" note={manager ? "People you invite sign in with Cloudflare using that email. Projects stay private to their maker until they share them." : "Everyone in this organization. Owners and admins invite people."}>
      <ul className="grid gap-1.5" id="org-members">
        {people?.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2 text-sm" data-member={m.email ?? m.userId}>
            <span className="min-w-0 flex-1 truncate">{m.email ?? "Someone without an email"}</span>
            {manager && (m.role !== "owner" || props.org.role === "owner") ? (
              <>
                <Choice label={`Role of ${m.email ?? "member"}`} value={m.role} options={roles} disabled={busy} onChange={(next) => void change(() => orgApi.setRole(m.userId, next))} />
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${m.email ?? "member"}`} disabled={busy} onClick={() => void change(() => orgApi.remove(m.userId), "Removed")}>
                  <X />
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{ROLE_NAME[m.role]}</span>
            )}
          </li>
        ))}
        {people?.invites.map((i) => (
          <li key={i.email} className="flex items-center gap-2 text-sm text-muted-foreground" data-invite={i.email}>
            <span className="min-w-0 flex-1 truncate">{i.email}</span>
            <span className="text-xs">Invited as {ROLE_NAME[i.role].toLowerCase()}</span>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Cancel the invitation for ${i.email}`} disabled={busy} onClick={() => void change(() => orgApi.cancelInvite(i.email))}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      {manager ? (
        <form
          id="invite-member"
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void change(async () => {
              const result = await orgApi.invite(email, role);
              setEmail("");
              return result;
            }, "Invited");
          }}
        >
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" aria-label="Email address to invite" required />
          <Choice label="Role for the invited person" value={role} options={roles} onChange={setRole} />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            Invite
          </Button>
        </form>
      ) : null}
    </Group>
  );
}

const ORG_LEVELS: Readonly<Partial<Record<ProjectLevel, string>>> = { view: LEVEL_NAME.view, edit: LEVEL_NAME.edit };

export function SharingSection(props: { readonly project: string; readonly access: ProjectAccess | null; readonly onChange: (next: ProjectAccess) => void }) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  const api = sharingApi(props.project);
  const { access } = props;
  if (!access) return <p className="text-xs text-muted-foreground">Loading who can open this project</p>;
  if (!access.sharing) return <p className="text-sm" data-current="project-access">You {LEVEL_NAME[access.you].toLowerCase()} this project. Ask someone who manages it to change that.</p>;
  const sharing = access.sharing;
  const change = async (work: () => Promise<ProjectAccess>) => {
    setBusy(true);
    const next = await attempt(work);
    if (next) props.onChange(next);
    setBusy(false);
  };
  const inside = new Set(sharing.people.map((p) => p.userId));
  const others = (access.members ?? []).filter((m) => !inside.has(m.userId) && m.role === "member");
  return (
    <>
      <Group title="Who can open it" note="Owners and admins of the organization can always open and manage every project.">
        <div className="flex items-center gap-2">
          <Choice<"private" | "org"> wide label="Who can open this project" value={sharing.visibility} options={{ private: "Only people added", org: "Everyone in the org" }} disabled={busy} onChange={(next) => void change(() => api.share(next, sharing.orgLevel === "manage" ? "edit" : sharing.orgLevel))} />
          {sharing.visibility === "org" ? <Choice label="What everyone in the org can do" value={sharing.orgLevel} options={ORG_LEVELS} disabled={busy} onChange={(next) => void change(() => api.share("org", next))} /> : null}
        </div>
      </Group>
      <Group title="People" note="Can view: see the chat, features and previews. Can edit: ask chef for changes and ship them. Can manage: also change settings, keys and sharing.">
        <ul className="grid gap-1.5" id="project-people">
          {sharing.people.map((p) => (
            <li key={p.userId} className="flex items-center gap-2 text-sm" data-person={p.email ?? p.userId}>
              <span className="min-w-0 flex-1 truncate">{p.email ?? "Someone without an email"}</span>
              <Choice label={`Access of ${p.email ?? "person"}`} value={p.level} options={LEVEL_NAME} disabled={busy} onChange={(next) => void change(() => api.setLevel(p.userId, next))} />
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${p.email ?? "person"}`} disabled={busy} onClick={() => void change(() => api.setLevel(p.userId, null))}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
        {others.length > 0 ? (
          <div className="flex items-center gap-2">
            <Select value={adding} onValueChange={setAdding}>
              <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Person to add">
                <SelectValue placeholder="Add someone from the organization" />
              </SelectTrigger>
              <SelectContent>
                {others.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.email ?? m.userId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" variant="outline" disabled={busy || !adding} onClick={() => void change(() => api.setLevel(adding, "edit")).then(() => setAdding(""))}>
              Add
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Invite people to the organization in Settings › General to add them here.</p>
        )}
      </Group>
    </>
  );
}
