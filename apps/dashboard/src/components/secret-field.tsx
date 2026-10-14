import type { ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function maskedKey(hint: string): string {
  return `••••••••••••${hint.startsWith("…") ? hint.slice(1) : ""}`;
}

export function SavedKey(props: { readonly hint: string; readonly label: string; readonly action?: ReactNode }) {
  const lastFour = props.hint.startsWith("…") ? props.hint.slice(1) : null;
  return (
    <div className="flex h-8 min-w-0 items-center gap-2 rounded-lg border border-input bg-muted/50 pr-1 pl-2.5 dark:bg-input/30">
      <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono text-xs tracking-wider" aria-label={lastFour ? `${props.label} saved, ending in ${lastFour}` : `${props.label} saved`} data-key-hint={props.hint}>
        {maskedKey(props.hint)}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">Saved</span>
      {props.action}
    </div>
  );
}

export function SecretField(props: {
  readonly name: string;
  readonly label: string;
  readonly hint: string | null;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly editing: boolean;
  readonly onEditing: (editing: boolean) => void;
  readonly reenter?: string | null;
}) {
  const { hint, label, reenter } = props;
  const open = !hint || props.editing || Boolean(reenter);
  return (
    <div className="grid gap-1" data-current={props.name} data-set={hint ? "yes" : "no"}>
      {open ? (
        <div className="flex gap-2">
          <Input value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={hint ? `Paste a new ${label}` : label} aria-label={label} type="password" autoComplete="off" autoFocus={props.editing} required />
          {hint && props.editing && !reenter ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => {
                props.onChange("");
                props.onEditing(false);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      ) : (
        <SavedKey
          hint={hint}
          label={label}
          action={
            <Button type="button" variant="ghost" size="xs" onClick={() => props.onEditing(true)}>
              Replace
            </Button>
          }
        />
      )}
      {hint && reenter ? <p className="text-xs text-muted-foreground">{reenter}</p> : null}
    </div>
  );
}
