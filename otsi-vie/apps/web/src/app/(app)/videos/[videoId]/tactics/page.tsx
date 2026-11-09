import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/identity";

/** The per-video tactics address opens Page 05 with that video. */
export default async function Page({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  if (!isUuid(videoId)) notFound();
  redirect(`/tactics?video=${videoId}`);
}
