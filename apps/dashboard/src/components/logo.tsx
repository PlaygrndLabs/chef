import { BLUE, MARK, WORDMARK } from "@chef/core/brand";
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox={WORDMARK.viewBox} fill="currentColor" role="img" aria-label="chef" className={cn("h-[18px] w-auto shrink-0", className)}>
      <path fill={BLUE} d={MARK.d} />
      <path fillRule="evenodd" d={WORDMARK.d} />
    </svg>
  );
}

export function Mark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="-75 -30 330 330" className={cn("size-7 shrink-0", className)} aria-hidden>
      <path fill={BLUE} d={MARK.d} />
    </svg>
  );
}
