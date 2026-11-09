/**
 * Owner acceptance journey, steps 3-8 (ADR-020), on REAL match footage (France–Germany clip, CC BY-SA 4.0, Wikimedia Commons;
 * .local/eval-footage): upload through the browser, start the analysis from the UI, follow the worker's real progress, open the
 * Analysis Workspace, see the detected boxes over the playback copy, select a player by clicking his box, and review his identity
 * (temporary track number first; a name only after a person confirms it; and back again), link the video to a match, enter and
 * verify both rosters, assign kit groups to teams, review shirt-number evidence and suggestions, then build and render the reel.
 * Skipped when the footage is absent.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./session";

const FOOTAGE = process.env.OTSI_E2E_FOOTAGE ?? "";
const SHOTS = process.env.OTSI_E2E_SHOTS;

test.beforeEach(async ({ page }) => {
  test.skip(!FOOTAGE, "real match footage is not present (.local/eval-footage)");
  await signIn(page);
});

test("journey 3-8: real footage -> start analysis -> progress -> workspace boxes -> select a player -> identity review", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await page.goto("/upload");
  const projectLine = page.locator('[data-action="project"]');
  if ((await projectLine.textContent())?.includes("No project yet")) {
    await page.getByRole("button", { name: "Browse Files" }).click(); // no project yet: opens the project dialog instead of the file chooser
    const dialog = page.locator('[data-dialog="project"]');
    await dialog.getByLabel("New project name").fill("Season 2026");
    await dialog.getByRole("button", { name: "Create Project" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(projectLine).not.toContainText("No project yet");
  }
  await page.getByLabel("Video files").setInputFiles(FOOTAGE);
  const recent = page.getByRole("region", { name: "Recent uploads panel" });
  const item = recent.getByRole("button", { name: /^france_germany/ });
  await expect(item.locator("[data-video-state]")).toHaveAttribute("data-video-state", "INGESTED", { timeout: 4 * 60_000 });
  await item.click();
  await page.getByRole("link", { name: "Analyse this video" }).click();

  // step 4: start the analysis through the UI (defaults: 2 analysed frames per second, distant players too)
  await expect(page).toHaveURL(/\/videos\/[0-9a-f-]{36}\/processing$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
  // the footage check runs by itself (ADR-034): measured issues, a recommended profile and per-profile estimates; the user may override
  await expect(page.locator("[data-assessment]")).toHaveAttribute("data-assessment", "SUCCEEDED", { timeout: 3 * 60_000 });
  await expect(page.locator("[data-profile] .text-ok", { hasText: "recommended" })).toHaveCount(1);
  await expect(page.locator("[data-estimate=ULTRA_SENSITIVE]")).toContainText("Estimate: about");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-footage-check.png`, fullPage: true });
  await page.getByRole("radio", { name: "Standard", exact: true }).check();           // this journey runs the fast profile
  await page.getByRole("button", { name: "Start analysis" }).click();

  // step 5: the worker's real progress, until every step has succeeded
  const steps = page.getByRole("list", { name: "Analysis steps" });
  await expect(steps.locator("[data-step=DETECT]")).toHaveAttribute("data-step-status", /QUEUED|RUNNING|SUCCEEDED/);
  await expect(steps.locator("[data-step='EVENTS']")).toContainText("not built yet");
  await expect(steps.locator("[data-step=IDENTIFY]")).toHaveAttribute("data-step-status", "SUCCEEDED", { timeout: 8 * 60_000 });
  await expect(steps.locator("[data-step=TRACK]")).toHaveAttribute("data-step-status", "SUCCEEDED");
  const people = Number(await page.locator("[data-metric='People tracked']").innerText());
  expect(people).toBeGreaterThan(5);                                      // a real broadcast clip with two teams on the pitch
  await expect(page.locator("[data-metric='Detector']")).toContainText("rtdetr_v2_r18vd");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-processing-done.png`, fullPage: true });

  // step 6: the Analysis Workspace with the playback copy
  await page.getByRole("link", { name: "Open Analysis Workspace" }).click();
  await expect(page).toHaveURL(/\/analyze$/);
  await expect(async () => {                                               // the playback copy may still be in the making
    await page.reload();
    await expect(page.getByLabel("Match video")).toBeAttached({ timeout: 2000 });
  }).toPass({ timeout: 4 * 60_000, intervals: [3000] });
  await page.getByLabel("Match video").evaluate((v: HTMLVideoElement) => new Promise<void>((ok) => {
    const go = () => { v.currentTime = 6; v.addEventListener("seeked", () => ok(), { once: true }); };
    if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true });
  }));

  // step 7: real boxes at the playhead; temporary track numbers, no names
  const boxes = page.locator("[data-box-class=PERSON]");
  await expect.poll(async () => boxes.count(), { timeout: 30_000 }).toBeGreaterThan(3);
  await expect(page.locator("[data-box-class=PERSON] text").first()).toHaveText(/^track \d+$/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-workspace-boxes.png`, fullPage: true });

  // step 8 (selection + identity review): click a player's box
  const box = boxes.first();
  const n = await box.getAttribute("data-box-track");
  await box.dispatchEvent("click");
  const card = page.locator(`[data-selected-track='${n}']`);
  await expect(card.locator("[data-track-label]")).toHaveText(`Unidentified person · track ${n}`);
  await expect(card).toContainText(`Temporary track ${n} (this analysis only)`);
  await expect(card.locator("[data-identity-state]")).toHaveAttribute("data-identity-state", "UNRESOLVED");
  await expect(page.getByRole("img", { name: "Observed spans of the selected track" }).locator("[data-span]").first()).toBeAttached();

  await card.getByLabel("New player name").fill("E2E Test Player");
  await card.getByRole("button", { name: "Create & confirm" }).click();
  await expect(card.getByRole("status")).toContainText("created and confirmed");
  await expect(card.locator("[data-identity-state]")).toHaveAttribute("data-identity-state", "CONFIRMED");
  await expect(card.locator("[data-track-label]")).toHaveText("E2E Test Player · provisional, no OTSI Player ID yet");
  await expect(page.locator(`[data-box-track='${n}'] text`)).toHaveText("E2E Test Player");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-identity-confirmed.png`, fullPage: true });

  // match, rosters and teams (ADR-033): created by clicking; a colour group becomes a team only when a person says so
  const stamp = Date.now().toString(36);
  const linker = page.locator("[data-match-linker]").first();
  await linker.getByRole("button", { name: "Create match" }).click();
  for (const [side, name] of [["Home", `E2E Home ${stamp}`], ["Away", `E2E Away ${stamp}`]] as const) {
    await linker.getByLabel(`${side} club`, { exact: true }).fill(name);
    await linker.getByRole("button", { name: `Create club "${name}"` }).click();
    await expect(linker.locator(`[data-club='${side}']`)).toHaveText(name);
  }
  await linker.getByLabel("Competition").fill("E2E Cup");
  await linker.getByRole("button", { name: "Create match and link video" }).click();
  await expect(linker.locator("[data-linked-match]")).toContainText(`E2E Home ${stamp} v E2E Away ${stamp}`);

  await page.getByRole("tab", { name: "Roster" }).click();
  const roster = page.locator("[data-roster]");
  const homeAdd = page.getByRole("form", { name: `Add player to E2E Home ${stamp}` });
  await homeAdd.getByLabel(`Player for E2E Home ${stamp}`).fill("E2E Test");
  await homeAdd.getByRole("button", { name: /E2E Test Player · provisional/ }).click();          // the player confirmed above, from the registry
  await homeAdd.getByLabel("Shirt number").fill("10");
  await homeAdd.getByLabel("Position").selectOption("CM");
  await homeAdd.getByRole("button", { name: "Add" }).click();
  await expect(roster.locator("[data-roster-player='E2E Test Player']")).toContainText("starter · CM");
  const awayAdd = page.getByRole("form", { name: `Add player to E2E Away ${stamp}` });
  await awayAdd.getByLabel(`Player for E2E Away ${stamp}`).fill("E2E Away Keeper");
  await awayAdd.getByLabel("Shirt number").fill("1");
  await awayAdd.getByLabel("Position").selectOption("GK");
  await awayAdd.getByRole("button", { name: "Add" }).click();                                  // a new provisional player
  await expect(roster.locator("[data-roster-player='E2E Away Keeper']")).toContainText("provisional, no OTSI Player ID yet");
  await roster.locator("[data-verify-roster]").click();
  await expect(roster).toHaveAttribute("data-roster-verified", "1");
  await roster.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("list", { name: "Roster history" })).toContainText("verified E2E Test Player");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-roster.png`, fullPage: true });

  await page.getByRole("tab", { name: "Teams" }).click();
  const teams = page.locator("[data-team-assignment]");
  await teams.getByLabel("Team of kit A").selectOption({ label: `E2E Home ${stamp}` });
  await expect(teams.getByRole("status")).toHaveText("Kit A saved.");
  await teams.getByLabel("Team of kit B").selectOption({ label: `E2E Away ${stamp}` });
  await expect(teams.getByRole("status")).toHaveText("Kit B saved.");
  await expect(teams.getByLabel("Team of kit A")).toBeDisabled();                              // changing it now needs a reason
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-teams.png`, fullPage: true });
  await page.getByRole("tab", { name: "Tracks" }).click();

  // shirt-number evidence on another person track, and suggestions that decide nothing
  const other = page.getByRole("list", { name: "Tracks" }).locator(`[data-track]:not([data-track='${n}'])`).first();
  const on = await other.getAttribute("data-track");
  await other.click();
  const otherCard = page.locator(`[data-selected-track='${on}']`);
  const shirt = otherCard.locator("[data-jersey-state]");
  await expect(shirt).toHaveAttribute("data-jersey-state", /RECOGNIZED|UNCERTAIN|UNREADABLE|TOO_SMALL|NOT_MEASURED/);
  if (await otherCard.getByRole("button", { name: "I can see this number" }).count()) {
    await otherCard.getByLabel("Shirt number seen").fill("10");
    await otherCard.getByRole("button", { name: "I can see this number" }).click();
    await expect(otherCard.locator("[data-jersey-decision]")).toHaveAttribute("data-jersey-decision", "CONFIRMED");
    const cand = otherCard.locator("[data-candidate='E2E Test Player']");
    await expect(cand).toContainText("roster");                                                // No. 10 looked up in the verified roster
    if (await cand.getByRole("note").count()) await expect(cand.getByRole("button", { name: "This is E2E Test Player" })).toBeDisabled();
    await expect(otherCard.locator("[data-identity-state]")).toHaveAttribute("data-identity-state", "UNRESOLVED");   // nothing decided by itself
  } else {
    test.info().annotations.push({ type: "note", description: `track ${on}: shirt number ${await shirt.getAttribute("data-jersey-state")} (no number to review)` });
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-shirt-number.png`, fullPage: true });
  await page.getByLabel("Minimum observations").selectOption("1");
  await page.getByRole("list", { name: "Tracks" }).locator(`[data-track='${n}']`).click();

  // same-person evidence (ADR-031): two kit colour groups on the pitch, and a look-alike suggestion a person confirms
  const trackList = page.getByRole("list", { name: "Tracks" });
  await expect(trackList.getByText("kit A").first()).toBeVisible();
  await expect(trackList.getByText("kit B").first()).toBeVisible();
  const withSuggestion = trackList.getByRole("button").filter({ hasText: "to review" }).first();
  if (await withSuggestion.count()) {
    await withSuggestion.click();
    const panel = page.getByLabel("Same person elsewhere");
    const proposal = panel.locator("[data-link-state=PROPOSED]").first();
    const linkId = await proposal.getAttribute("data-link");
    await proposal.getByRole("button", { name: "Same person" }).click();
    await expect(panel.locator(`[data-link='${linkId}']`)).toHaveAttribute("data-link-state", "CONFIRMED");
    await expect(panel.locator("[data-person-group]")).toContainText("Same person on 2 tracks");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-same-person-link.png`, fullPage: true });
    await page.getByLabel("Minimum observations").selectOption("1");
    await trackList.locator(`[data-track='${n}']`).click();          // back to the player reviewed above
  }

  // journey 10-13: the reel. Created from the confirmed player, built by clicking, rendered to a validated MP4 with the spotlight
  await page.locator("[data-create-reel]").click();
  await expect(page).toHaveURL(/\/reels\/[0-9a-f-]{36}$/);
  const reelUrl = page.url();
  await expect(page.locator("[data-reel-player]")).toContainText("E2E Test Player");
  await expect(page.getByRole("list", { name: "Clips" })).toHaveCount(0);                    // nothing pre-filled
  const moments = page.getByRole("list", { name: "Suggested moments" });
  await expect(moments.getByRole("listitem").first()).toBeVisible();
  await moments.getByRole("button", { name: "Add to reel" }).first().click();
  await expect(page.getByRole("list", { name: "Clips" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Render reel" }).click();
  const panel = page.locator("[data-render-state]");
  await expect(panel).toHaveAttribute("data-render-state", "SUCCEEDED", { timeout: 8 * 60_000 });
  await expect(page.locator("[data-render-result]")).toContainText("1920×1080");
  await expect(page.locator("[data-render-result]")).toContainText("frames on detections");
  const download = await page.locator("[data-download]").getAttribute("href");
  const file = await page.request.get(download!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("video/mp4");
  expect(file.headers()["content-disposition"]).toMatch(/^attachment; filename="otsi-reel-.+\.mp4"$/);
  expect((await file.body()).subarray(4, 8).toString()).toBe("ftyp");                          // an MP4 container
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/journey-reel-rendered.png`, fullPage: true });
  await page.goBack();
  await expect(page).toHaveURL(/\/analyze$/);
  await page.getByLabel("Minimum observations").selectOption("1");
  await page.getByRole("list", { name: "Tracks" }).locator(`[data-track='${n}']`).click();

  // a correction is appended, never written over: back to unidentified
  await expect(card.getByRole("button", { name: "Back to unidentified" })).toBeDisabled();     // a correction needs a reason
  await card.getByLabel("Reason for the correction").fill("E2E: checking that a correction is recorded");
  await card.getByRole("button", { name: "Back to unidentified" }).click();
  await expect(card.locator("[data-identity-state]")).toHaveAttribute("data-identity-state", "UNRESOLVED");
  await expect(card.locator("[data-track-label]")).toHaveText(`Unidentified person · track ${n}`);

  // the reel followed that identity: it is now stale and cannot render until its targets are refreshed
  await page.goto(reelUrl);
  await expect(page.getByRole("alert").filter({ hasText: "was corrected" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Render reel" })).toBeDisabled();
});
