import { useSyncExternalStore } from "react";

const KEY = "chef:talk-button";
const CHANGED = "chef:talk-button";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "hidden";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useTalkButton(): readonly [boolean, (shown: boolean) => void] {
  const shown = useSyncExternalStore(subscribe, read, () => true);
  const set = (next: boolean) => {
    try {
      if (next) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, "hidden");
    } catch {
      return;
    }
    window.dispatchEvent(new Event(CHANGED));
  };
  return [shown, set];
}
