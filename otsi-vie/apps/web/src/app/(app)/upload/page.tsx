import type { Metadata } from "next";
import { Suspense } from "react";
import { DesignStage } from "@/components/stage/DesignStage";
import { DropZoneSection } from "@/components/upload/DropZoneSection";
import { IngestConfigPanel } from "@/components/upload/IngestConfigPanel";
import { MatchContextSection } from "@/components/upload/MatchContextSection";
import { RIGHT_EXTRA } from "@/components/upload/layout";
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
 * Page 02 Upload & Ingest on the approved composition (corrected reference 02_UPLOAD_INGEST), section by section on real data:
 * 01 header and source tabs, 02 match context, 03 visual processing, 04 detection and ingest options, 05 drop zone, 06 link import,
 * 07 supported formats, 08 recent uploads, 09 selected upload, 10 processing pipeline. The data layer is UploadWorkspace (useUpload);
 * Page02Controller adds preferences, match linking, runs, the real upload limit and the status line.
 */
export default function Page() {
  return (
    <UploadWorkspace>
      <Suspense fallback={null}>
        <Page02Controller>
          <DesignStage page="upload" extra={RIGHT_EXTRA}>
            <UploadHeaderSection />
            <StatusLine />
            <MatchContextSection />
            <IngestConfigPanel />
            <DropZoneSection />
            <UrlInputSection />
            <SupportedFormatsSection />
            <RecentUploadsSection />
            {/* the preview sits below the taller Recent Uploads panel: the same composition, moved down by the added height */}
            <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none", transform: `translateY(calc(${RIGHT_EXTRA} * var(--u)))` }}><div style={{ pointerEvents: "auto" }}><SelectedPreviewSection /></div></div>
            <PipelinePreviewSection />
          </DesignStage>
        </Page02Controller>
      </Suspense>
    </UploadWorkspace>
  );
}
