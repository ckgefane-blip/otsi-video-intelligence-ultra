import type { Metadata } from "next";
import { PreferencesView } from "@/components/settings/PreferencesView";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";

export const metadata: Metadata = { title: "Preferences" };

/**
 * Settings > Preferences (SOT, Preferences.dc.html): appearance & language, notifications, licence & updates,
 * and storage on this computer. The Settings side nav is shared by the Settings and Admin Console pages.
 */
export default function PreferencesPage() {
  return (
    <div className="flex h-full w-full" data-stage="settings-preferences" data-page="settings-preferences">
      <SettingsSideNav current="preferences" />
      <PreferencesView />
    </div>
  );
}
