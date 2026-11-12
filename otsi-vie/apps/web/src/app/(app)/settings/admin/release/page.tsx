import type { Metadata } from "next";
import { ReleaseControl } from "@/components/admin/ReleaseControl";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";

export const metadata: Metadata = { title: "Release Control" };

/**
 * Admin Console > Release Control (SOT, AdminRelease.dc.html): the
 * accuracy gates on labelled football footage (G05 Detection, G06
 * Tracking, G07 Identity). Available to Owners and Admins (Advanced).
 * The Settings side nav is shared by the Settings and Admin Console pages.
 */
export default function AdminReleasePage() {
  return (
    <div className="flex h-full w-full" data-stage="settings-admin-release" data-page="settings-admin-release">
      <SettingsSideNav current="release" />
      <ReleaseControl />
    </div>
  );
}
