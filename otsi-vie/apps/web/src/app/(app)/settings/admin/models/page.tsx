import type { Metadata } from "next";
import { ModelsAi } from "@/components/admin/ModelsAi";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";

export const metadata: Metadata = { title: "Models & AI" };

/**
 * Admin Console > Models & AI (SOT, AdminModels.dc.html): the models
 * available to the engine. Available to Owners and Admins (Advanced).
 * The Settings side nav is shared by the Settings and Admin Console pages.
 */
export default function AdminModelsPage() {
  return (
    <div className="flex h-full w-full" data-stage="settings-admin-models" data-page="settings-admin-models">
      <SettingsSideNav current="models" />
      <ModelsAi />
    </div>
  );
}
