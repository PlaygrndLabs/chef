import { useEffect, useState } from "react";
import { ApiError, settingsApi, type SettingsView } from "./api";

export function missingSettings(settings: SettingsView | null): string[] {
  if (!settings) return [];
  return [...(settings.llm ? [] : ["models"]), ...(settings.cloudflare || settings.runsOn === "computer" ? [] : ["previews"])];
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    settingsApi.get().then(setSettings, (e: unknown) => {
      if (e instanceof ApiError && e.status === 404) setAvailable(false);
    });
  }, []);
  return { settings, setSettings, available };
}
