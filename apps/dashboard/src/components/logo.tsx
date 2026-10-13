import { LETTER, WORDMARK } from "@chef/core/brand";
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox={WORDMARK.viewBox} fill="currentColor" role="img" aria-label="chef" className={cn("h-4 w-auto shrink-0", className)}>
      <path fillRule="evenodd" d={WORDMARK.d} />
    </svg>
  );
}

export function Mark({ className }: { readonly className?: string }) {
  return (
    <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-foreground text-background", className)} aria-hidden>
      <svg viewBox={`0 0 ${LETTER.size} ${LETTER.size}`} fill="currentColor" className="size-[55%]">
        <path fillRule="evenodd" d={LETTER.d} />
      </svg>
    </span>
  );
}
