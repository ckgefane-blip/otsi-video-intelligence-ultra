/**
 * Owner acceptance journey, steps 1-3 (ADR-020), for real: an empty workspace, create a project (in the project dialog), upload a real
 * video through the browser (several 1 MiB parts), the outbox dispatcher creates the ingest job, the Python worker verifies, probes and
 * test-decodes it, and the page shows the measured facts and a thumbnail decoded from the file. A renamed non-video is quarantined with
 * its reason. The videos are synthetic test files generated for this run (tools/dev/test_media.py).
 *
 * Rebuilt for Page 02's real-data rebuild (commit d43b7b7): the project line lives in the drop zone, not the sidebar; a project is
 * chosen/created in a dialog (data-action="project", or Browse Files/a format tile when none is chosen yet); upload progress shows in
 * the Processing Pipeline's Uploading card, not a separate list.
 */
import { expect, test } from "@playwright/test";
import path from "node:path";
import { signIn } from "./session";

const MEDIA = process.env.OTSI_E2E_MEDIA ?? "";

test.beforeEach(async ({ page }) => {
  expect(MEDIA, "run through tools/dev/e2e.py").not.toBe("");
  await signIn(page);
});

test("journey 1-3: empty workspace, create a project, upload a real video, see it verified with measured facts", async ({ page }) => {
  await page.goto("/upload");
  const recent = page.getByRole("region", { name: "Recent uploads panel" });
  await expect(recent).toContainText("No uploads yet");
  await expect(recent).toContainText("Uploaded videos appear here");

  // the drop zone's project line: no project yet
  const dropzone = page.getByRole("region", { name: "Primary drag-drop file panel" });
  const projectLine = dropzone.locator('[data-action="project"]');
  await expect(projectLine).toContainText("No project yet");

  // Browse Files is never dead: with no project it opens the project dialog instead of the file chooser
  const browse = dropzone.getByRole("button", { name: "Browse Files" });
  await expect(browse).toBeEnabled();
  await browse.click();
  const dialog = page.locator('[data-dialog="project"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Create your first project to start");

  await dialog.getByLabel("New project name").fill("Season 2026");
  await dialog.getByRole("button", { name: "Create Project" }).click();
  await expect(dialog.getByLabel("Project", { exact: true }).locator("option:checked")).toHaveText("Season 2026 (0 videos)");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(projectLine).toContainText("Season 2026");

  await page.getByLabel("Video files").setInputFiles(path.join(MEDIA, "clip.mp4"));
  const pipeline = page.getByRole("list", { name: "Processing pipeline" });
  const uploading = pipeline.locator("li[data-stage='Uploading']");
  await expect(uploading).toHaveAttribute("data-transfer-state", "done", { timeout: 60_000 });
  await expect(uploading).toHaveAttribute("data-stage-state", "done", { timeout: 90_000 });

  const item = recent.getByRole("button", { name: /^clip/ }); // not "More for clip" (the row's own ⋮ menu button)
  await expect(item.locator("[data-video-state]")).toHaveAttribute("data-video-state", "INGESTED", { timeout: 90_000 });
  await expect(item).toContainText("Ready");
  await expect(item).toContainText("0:04");
  await item.click();

  const details = page.getByRole("region", { name: "Selected upload preview / metadata editor" });
  await expect(details).toContainText("320 × 240");
  await expect(details).toContainText("25 fps");
  await expect(details).toContainText("mpeg4 + aac");
  await expect(details).toContainText("0:04");
  await expect(details.getByRole("img", { name: /Frame from clip/ })).toBeVisible();

  // "Send to Analysis" defaults on (otsi.upload.prefs): an analysis run starts by itself once the upload is verified, so the pipeline
  // moves past "AI Detection: Not started" without a manual click — this proves the real auto-start, not a fabricated progress value.
  const detect = pipeline.locator("li[data-stage='AI Detection']");
  await expect(detect).not.toHaveAttribute("data-stage-state", "todo", { timeout: 20_000 });

  // rename via Edit Metadata (PATCH /v1/videos/:id), shown in Recent Uploads after reload
  await details.getByRole("button", { name: "Edit Metadata" }).click();
  const rename = page.getByRole("dialog", { name: "Edit metadata" });
  await rename.getByLabel("Video title").fill("Clip, renamed");
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(rename).toBeHidden();
  await expect(recent.getByRole("button", { name: /^Clip, renamed/ })).toBeVisible();

  if (process.env.OTSI_E2E_SHOTS) await page.screenshot({ path: `${process.env.OTSI_E2E_SHOTS}/journey-upload-verified.png`, fullPage: true });
});

test("a file that is not a video is quarantined with the reason, whatever its name", async ({ page }) => {
  await page.goto("/upload");
  await expect(page.locator('[data-action="project"]')).toContainText("Season 2026"); // created by the previous test; real server state
  await page.getByLabel("Video files").setInputFiles(path.join(MEDIA, "not-a-video.mp4"));
  const item = page.getByRole("region", { name: "Recent uploads panel" }).getByRole("button", { name: /^not-a-video/ });
  await expect(item.locator("[data-video-state]")).toHaveAttribute("data-video-state", "QUARANTINED", { timeout: 90_000 });
  await item.click();
  await expect(page.getByRole("region", { name: "Selected upload preview / metadata editor" }).getByRole("alert")).toContainText("NOT_A_VIDEO");
});

test("files of the wrong type are refused before uploading", async ({ page }) => {
  await page.goto("/upload");
  await expect(page.locator('[data-action="project"]')).toContainText("Season 2026");
  await page.getByLabel("Video files").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
  const uploading = page.getByRole("list", { name: "Processing pipeline" }).locator("li[data-stage='Uploading']");
  await expect(uploading).toHaveAttribute("data-transfer-state", "error", { timeout: 15_000 });
  await expect(uploading).toContainText("Accepted video files");
});

test("paste-link import explains each provider before submitting and refuses private addresses", async ({ page }) => {
  await page.goto("/upload?mode=url");
  await expect(page.locator('[data-action="project"]')).toContainText("Season 2026");
  const form = page.getByRole("region", { name: "URL input and external-source ingestion" });
  // YouTube: refused with the reason and the lawful alternative; Add URL explains instead of submitting
  await form.getByLabel("Video URL").fill("https://www.youtube.com/watch?v=abc123");
  const yt = form.locator("[data-provider=youtube]");
  await expect(yt).toHaveAttribute("data-provider-status", "unsupported");
  await expect(yt).toContainText("YouTube Studio");
  await form.getByRole("button", { name: "Add URL" }).click();
  await expect(form.getByRole("alert")).toContainText("cannot be imported");
  // Vimeo: asks for the user's own token; the API refuses without it
  await form.getByLabel("Video URL").fill("https://vimeo.com/123456789");
  await expect(form.locator("[data-provider=vimeo]")).toHaveAttribute("data-provider-status", "needs_authorization");
  await expect(form.getByLabel("Access token")).toBeVisible();
  // Wikimedia Commons: importable
  await form.getByLabel("Video URL").fill("https://commons.wikimedia.org/wiki/File:Match.webm");
  await expect(form.locator("[data-provider=wikimedia]")).toHaveAttribute("data-provider-status", "supported");
  await form.getByRole("button", { name: "Which links work?" }).click();
  await expect(page.getByRole("dialog", { name: "Which links work?" }).getByRole("list", { name: "Link support" }).getByRole("listitem")).toHaveCount(16);
  await page.keyboard.press("Escape");
  await form.getByLabel("Video URL").fill("http://192.168.1.20/match.mp4");
  await form.getByRole("button", { name: "Add URL" }).click();
  await expect(form.getByRole("alert")).toContainText("private or local network");
});
