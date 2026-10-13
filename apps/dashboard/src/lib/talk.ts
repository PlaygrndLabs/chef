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

export interface TalkSpot {
  readonly right: number;
  readonly bottom: number;
}

const SPOT = "chef:talk-spot";
export const DEFAULT_SPOT: TalkSpot = { right: 24, bottom: 112 };

export function savedSpot(): TalkSpot {
  try {
    const spot = JSON.parse(localStorage.getItem(SPOT) ?? "null") as Partial<TalkSpot> | null;
    return typeof spot?.right === "number" && typeof spot.bottom === "number" ? { right: spot.right, bottom: spot.bottom } : DEFAULT_SPOT;
  } catch {
    return DEFAULT_SPOT;
  }
}

export function saveSpot(spot: TalkSpot) {
  try {
    localStorage.setItem(SPOT, JSON.stringify(spot));
  } catch {
    return;
  }
}

export function clampSpot(spot: TalkSpot, area: { readonly width: number; readonly height: number }, size: number, margin = 8): TalkSpot {
  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, margin), Math.max(margin, max - size - margin)));
  return { right: clamp(spot.right, area.width), bottom: clamp(spot.bottom, area.height) };
}
