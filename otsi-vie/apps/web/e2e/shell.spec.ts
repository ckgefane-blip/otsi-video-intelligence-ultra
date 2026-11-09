/**
 * Browser end-to-end tests of the web shell on the production build: every approved page renders all its sections with no sample data,
 * navigation (ten approved destinations), the page palette, upload source modes, route validation, security headers, small screens.
 * Full-page screenshots go to OTSI_E2E_SHOTS (release evidence) when that variable is set. Runs against the real API on a scratch
 * database (tools/dev/e2e.py); every app page needs a signed-in member, so each test signs in first.
 */
import { expect, test, type Page } from "@playwright/test";
import specs from "../src/lib/page-specs.generated.json";
import { OWNER, signIn } from "./session";

const VIDEO = "0190c6a0-0000-7000-8000-000000000001";
const ROUTES: { path: string; page: number; title: string }[] = [
  { path: "/dashboard", page: 1, title: "Professional Football Video Intelligence" },   // the approved hero heading
  { path: "/upload", page: 2, title: "Upload & Ingest" },
  { path: "/processing", page: 3, title: "AI Processing Pipeline" },
  { path: "/analysis", page: 4, title: "Analysis Workspace" },
  { path: "/tactics", page: 5, title: "Tactical Intelligence" },
  { path: "/reels", page: 6, title: "Reel Builder / Spotlight Composer" },
  { path: "/studio", page: 7, title: "Clip Studio / Timeline Editor" },
  { path: "/reports/players/OTSI-NGA-2026-000001", page: 8, title: "Player Report" },
  { path: "/library", page: 9, title: "Library / Project Center" },
  { path: "/exports", page: 10, title: "Export & Delivery" },
];

test.beforeEach(async ({ page }, info) => {
  if (!info.title.startsWith("signed out:")) await signIn(page);
});

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

for (const r of ROUTES) {
  test(`page ${String(r.page).padStart(2, "0")} ${r.title}: every approved section, no sample data, no errors`, async ({ page }) => {
    const errors = trackErrors(page);
    const res = await page.goto(r.path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: r.title })).toBeAttached();
    const spec = specs.pages.find((p) => p.page === r.page)!;
    const expected = spec.sections.filter((s) => !(r.page === 1 && s.n === 1)).map((s) => `p${String(r.page).padStart(2, "0")}-s${String(s.n).padStart(2, "0")}`);
    const rendered = await page.locator("main [data-section^='p']").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
    expect(rendered).toEqual(expected);
    for (const s of spec.sections.filter((x) => !(r.page === 1 && x.n === 1))) {
      await expect(page.getByRole("region", { name: s.title, exact: true })).toBeAttached();
    }
    // nothing pretends to be a measurement: no percentages, km/h, ratings or match scores anywhere in the page body
    // (the approved-design description of an unconnected section, marked data-spec-summary, and API contract chips are not values)
    const text = await page.locator("main").evaluate((m) => {
      const c = m.cloneNode(true) as HTMLElement;
      c.querySelectorAll("[data-spec-summary], [aria-label='API contract']").forEach((e) => e.remove());
      return c.innerText;
    });
    expect(text).not.toMatch(/\d+(\.\d+)?\s?(%|km\/h|km\b)|\b\d\s?-\s?\d\b|\/10\b/);
    await expect(page.locator("header [aria-current='page']")).toHaveCount(1);
    if (process.env.OTSI_E2E_SHOTS) {
      await page.screenshot({ path: `${process.env.OTSI_E2E_SHOTS}/page-${String(r.page).padStart(2, "0")}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test("the root opens Home and the navigation reaches every main area", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["Home", "Upload", "Processing", "Analysis", "Tactical", "Reel Builder", "Clip Studio", "Player Report", "Library", "Export"]);
  for (const [label, url] of [["Upload", /\/upload$/], ["Processing", /\/processing$/], ["Analysis", /\/analysis$/], ["Tactical", /\/tactics$/], ["Reel Builder", /\/reels$/],
    ["Clip Studio", /\/studio$/], ["Player Report", /\/reports$/], ["Library", /\/library$/], ["Export", /\/exports$/], ["Home", /\/dashboard$/]] as const) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
  }
});

test("Home CTAs open the upload page in the matching source mode, and the tabs switch it", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Paste Link" }).click();
  await expect(page).toHaveURL(/\/upload\?mode=url$/);
  await expect(page.getByRole("tab", { name: "YouTube / URL" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Batch Upload" }).click();
  await expect(page).toHaveURL(/\/upload\?mode=batch$/);
  await expect(page.getByRole("tab", { name: "Batch Upload" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Upload" })).toHaveAttribute("aria-current", "page");
});

test("Ctrl+K opens the page palette and Enter navigates", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Search pages" });
  await expect(input).toBeFocused();
  await input.fill("export");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/exports$/);
});

test("video and player routes accept only valid identifiers", async ({ page }) => {
  for (const ok of [`/videos/${VIDEO}/analyze`, `/videos/${VIDEO}/processing`, `/videos/${VIDEO}/tactics`, "/reports/players/0190c6a0-0000-7000-8000-000000000002"]) {
    expect((await page.goto(ok))?.status(), ok).toBe(200);
  }
  for (const bad of ["/videos/not-a-uuid/analyze", "/reports/players/17", "/reports/players/otsi-nga-2026-000001", "/no-such-page"]) {
    expect((await page.goto(bad))?.status(), bad).toBe(404);
  }
  await page.goto("/reports/players/OTSI-NGA-2026-000001");
  await expect(page.locator("[data-player-ref-kind='canonical']")).toContainText("OTSI-NGA-2026-000001");
});

test("security headers are sent", async ({ page }) => {
  const res = await page.goto("/dashboard");
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("small screens stack the sections without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 860 });
  for (const r of ROUTES) {
    await page.goto(r.path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, r.path).toBeLessThanOrEqual(0);
  }
});

test("signed out: app pages send the visitor to sign in and come back afterwards", async ({ page }) => {
  await page.goto("/library?tab=reels");
  await expect(page).toHaveURL(/\/login\?next=%2Flibrary%3Ftab%3Dreels$/);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill("definitely not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form [role='alert']")).toHaveText("Email or password is incorrect.");
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/library\?tab=reels$/);
  await expect(page.getByRole("button", { name: "Account: E2E Test Owner" })).toBeVisible();
});

test("signed out: the return address cannot leave the app", async ({ page }) => {
  await page.goto("/login?next=//evil.example/x");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:4310\/dashboard$/);
});

test("the profile shows the real user and role, and signing out ends the session", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Account: E2E Test Owner" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(OWNER.email);
  await expect(dialog.getByRole("radio", { name: /E2E Test Organization/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login(\?next=%2Fdashboard)?$/);
  await page.goto("/upload");
  await expect(page).toHaveURL(/\/login\?next=%2Fupload$/);
});

test("a reload keeps the session through the HttpOnly refresh cookie, which scripts cannot read", async ({ page }) => {
  await page.goto("/reels");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Reel Builder / Spotlight Composer" })).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain("otsi_vie_refresh");
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /token/i.test(k)))).toEqual([]);
});
