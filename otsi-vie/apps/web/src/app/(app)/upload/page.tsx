import type { Metadata } from "next";
import { Suspense } from "react";
import { DropZoneSection } from "@/components/upload/DropZoneSection";
import { IngestConfigPanel } from "@/components/upload/IngestConfigPanel";
import { MatchContextSection } from "@/components/upload/MatchContextSection";
import { Page02Controller, StatusLine } from "@/components/upload/page02";
import { PipelinePreviewSection } from "@/components/upload/PipelinePreviewSection";
import { RecentUploadsSection } from "@/components/upload/RecentUploadsSection";
import { SelectedPreviewSection } from "@/components/upload/SelectedPreviewSection";
import { SupportedFormatsSection } from "@/components/upload/SupportedFormatsSection";
import { UploadHeaderSection } from "@/components/upload/UploadHeaderSection";
import { UrlInputSection } from "@/components/upload/UrlInputSection";
import { UploadWorkspace } from "@/components/upload/UploadWorkspace";

export const metadata: Metadata = { title: "Upload & Ingest" };

/**
 * Page 02 Upload & Ingest — Desktop UI (Drop 2), on the same components and the same real API as before, laid out in
 * the page's flow instead of the 2560-px DesignStage composition:
 *   header (title, source tabs, help) + status line
 *   left    Match Context, then Visual Processing / Detection & Ingest Options (with the analysis profile card)
 *   centre  Drop zone (or link import on the URL tab), Supported Formats, Processing Pipeline
 *   right   Recent Uploads, then the Selected Upload preview (shared VideoPlayer on the signed playback URL)
 * The data layer is UploadWorkspace (useUpload); Page02Controller adds preferences, match linking, runs, the real upload
 * limit and the status line.
 */
export default function Page() {
  return (
    <UploadWorkspace>
      <Suspense fallback={null}>
        <Page02Controller>
          <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4" data-page="upload">
            <UploadHeaderSection />
            <StatusLine />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
              <div className="flex min-w-0 flex-col gap-4">
                <MatchContextSection />
                <IngestConfigPanel />
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <DropZoneSection />
                <UrlInputSection />
                <SupportedFormatsSection />
                <PipelinePreviewSection />
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <RecentUploadsSection />
                <SelectedPreviewSection />
              </div>
            </div>
          </div>
        </Page02Controller>
      </Suspense>
    </UploadWorkspace>
  );
}
