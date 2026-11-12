import type { Metadata } from "next";
import { Suspense } from "react";
import { MediaStage } from "@/components/upload/MediaStage";
import { Page02Controller } from "@/components/upload/page02";
import { UploadWorkspace } from "@/components/upload/UploadWorkspace";

export const metadata: Metadata = { title: "Upload & Ingest" };

/**
 * SOT UI rebuild Page 15 of 31: Media — upload & ingest.
 * The SOT's two-column Media page (centre: drop zone, tier alert + tier cards, add from a link, ingest queue; right inspector: ingest
 * settings) on the same data layer as before (UploadWorkspace + Page02Controller). The old three-column Upload page (Drop 2) is not
 * routed any more; its section files stay in the repo.
 */
export default function Page() {
  return (
    <UploadWorkspace>
      <Suspense fallback={null}>
        <Page02Controller>
          <MediaStage />
        </Page02Controller>
      </Suspense>
    </UploadWorkspace>
  );
}
