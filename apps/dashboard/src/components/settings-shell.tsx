import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface SettingsSection {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly note?: ReactNode;
  readonly attention?: boolean;
  readonly fill?: boolean;
  readonly render: () => ReactNode;
}

export function Group(props: { readonly title: string; readonly note?: ReactNode; readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <section className="grid gap-3 border-b pb-6 last:border-b-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="text-sm font-medium">{props.title}</h3>
          {props.note ? <p className="text-xs text-muted-foreground">{props.note}</p> : null}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export function SettingsShell(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly name: string;
  readonly heading: string;
  readonly kicker: string;
  readonly description: string;
  readonly sections: readonly SettingsSection[];
  readonly active: string;
  readonly onSelect: (section: string) => void;
  readonly footer?: ReactNode;
}) {
  const section = props.sections.find((s) => s.id === props.active) ?? (props.sections[0] as SettingsSection);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[min(52rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl md:flex-row" data-dialog={props.name} data-section={section.id}>
        <nav className="flex shrink-0 flex-col gap-0.5 border-b bg-sidebar p-2 md:w-56 md:border-r md:border-b-0 md:p-3" aria-label={`${props.heading} sections`}>
          <div className="hidden px-2 pt-1 pb-3 md:block">
            <div className="text-[11px] tracking-wide text-muted-foreground uppercase">{props.kicker}</div>
            <DialogTitle className="truncate text-sm font-semibold">{props.heading}</DialogTitle>
            <DialogDescription className="sr-only">{props.description}</DialogDescription>
          </div>
          <div className="flex gap-0.5 overflow-x-auto md:flex-col md:overflow-visible">
            {props.sections.map((s) => (
              <button
                key={s.id}
                type="button"
                data-settings-nav={s.id}
                aria-current={s.id === section.id ? "page" : undefined}
                onClick={() => props.onSelect(s.id)}
                className={cn("flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground", s.id === section.id && "bg-sidebar-accent font-medium text-foreground")}
              >
                <s.icon className="size-4 shrink-0" />
                <span className="truncate">{s.label}</span>
                {s.attention ? <span className="ml-auto size-1.5 shrink-0 rounded-full bg-bad" aria-label="needs setup" /> : null}
              </button>
            ))}
          </div>
          {props.footer ? <div className="mt-auto hidden px-2 pt-3 md:block">{props.footer}</div> : null}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-start gap-3 border-b px-5 py-3.5 pr-12 sm:px-6">
            <div className="grid min-w-0 gap-0.5">
              <h2 className="text-base font-semibold" data-settings-title>
                {section.label}
              </h2>
              {section.note ? <p className="text-xs text-muted-foreground">{section.note}</p> : null}
            </div>
          </header>
          {section.fill ? (
            <div className="flex min-h-0 flex-1 flex-col">{section.render()}</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto grid max-w-2xl gap-6 px-5 py-5 sm:px-6">{section.render()}</div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
