import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.turnstile = {
      render: (_node, options) => {
        setTimeout(() => (options.callback as (token: string) => void)("XXXX.DUMMY.TOKEN.XXXX"), 0);
        return "test-widget";
      },
      remove: () => {},
    };
  });
});

test("create from names, save an atlas, recover an edit link, and edit without replacing the atlas", async ({
  page,
  browser,
}) => {
  let uploads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/uploads")) uploads++;
  });
  await page.goto("/new");
  await page.getByLabel("List title", { exact: true }).fill("New roster");
  await page.getByLabel("Game / IP", { exact: true }).fill("A test game");
  await page
    .getByLabel("Paste character names, one per line")
    .fill(Array.from({ length: 11 }, (_, i) => `Hero ${i + 1}`).join("\n"));
  await page.getByRole("button", { name: "Add names", exact: true }).click();
  await page.getByRole("button", { name: "All two-way on", exact: true }).click();
  await expect(page.getByText("11 of 11 are two-way", { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "Visibility", exact: true }).selectOption("public");
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await expect(page.getByText("List saved.", { exact: false })).toBeVisible({ timeout: 20000 });
  expect(uploads).toBe(1);
  const edit = await page.getByRole("textbox", { name: "Edit link", exact: true }).inputValue();
  const publicLink = await page
    .getByRole("textbox", { name: "Share link", exact: true })
    .inputValue();
  expect(publicLink).not.toContain("token");
  const context = await browser.newContext();
  const editor = await context.newPage();
  await editor.addInitScript(() => {
    window.turnstile = {
      render: (_node, options) => {
        setTimeout(() => (options.callback as (token: string) => void)("XXXX.DUMMY.TOKEN.XXXX"), 0);
        return "test";
      },
      remove: () => {},
    };
  });
  await editor.goto(edit);
  await expect(editor.getByLabel("List title", { exact: true })).toHaveValue("New roster");
  expect(new URL(editor.url()).hash).toBe("");
  await editor.getByLabel("List title", { exact: true }).fill("Edited roster");
  await editor.getByRole("button", { name: "Save list", exact: true }).click();
  await expect(editor.getByText("List saved.", { exact: false })).toBeVisible({ timeout: 20000 });
  // A fresh visitor sees the newly published JSON; an existing browser may cache it for 60 s.
  const viewer = await browser.newPage();
  await viewer.goto(publicLink);
  await expect(viewer.getByRole("heading", { name: "Edited roster" })).toBeVisible();
  await expect(viewer.locator(".list-portraits .sprite")).toHaveCount(11);
  await viewer.getByRole("link", { name: "Build a team", exact: true }).click();
  await expect(viewer.getByTestId("pool").locator(".pool-card")).toHaveCount(11);
  await viewer.close();
  await context.close();
});

test("uses a JPEG atlas when WebP encoding is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      return encode.call(this, callback, type === "image/webp" ? "image/png" : type, quality);
    };
  });
  await page.goto("/new");
  await page.getByLabel("List title", { exact: true }).fill("JPEG fallback");
  await page.getByLabel("Game / IP", { exact: true }).fill("Test");
  await page
    .getByLabel("Paste character names, one per line")
    .fill(Array.from({ length: 11 }, (_, i) => `Hero ${i}`).join("\n"));
  await page.getByRole("button", { name: "Add names", exact: true }).click();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/lists") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  expect(((await (await response).json()) as { atlas: { key: string } }).atlas.key).toMatch(
    /\.jpg$/,
  );
  await expect(page.getByText("List saved.", { exact: false })).toBeVisible();
});

test("remix a full seed, filter two-way edits, and reuse its immutable atlas", async ({ page }) => {
  let uploads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/uploads")) uploads++;
  });
  await page.goto("/new?remix=demo-lol");
  await expect(page.getByText("0 of 173 are two-way", { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by tag", exact: true }).selectOption("Tank");
  await page.getByRole("button", { name: "Filtered two-way on", exact: true }).click();
  const tankCount = await page.locator(".editor-character").count();
  await expect(page.getByText(`${tankCount} of 173 are two-way`, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await expect(page.getByText("List saved.", { exact: false })).toBeVisible({ timeout: 20000 });
  expect(uploads).toBe(0);
  await page.getByRole("link", { name: "View saved list", exact: true }).click();
  await expect(page.locator(".list-portraits .sprite")).toHaveCount(173);
});

test("bulk portraits get names from filenames and crop before upload", async ({ page }) => {
  await page.goto("/new");
  await page.getByRole("heading", { name: "Create a character list" }).waitFor();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e00";
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = "#00e";
    ctx.fillRect(100, 0, 100, 100);
    return canvas.toDataURL().split(",")[1]!;
  });
  await page.getByLabel("Add portrait images (or drop files here)").setInputFiles({
    name: "Captain_Hero.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  const character = page.getByRole("article", { name: "Character Captain Hero", exact: true });
  await expect(character.getByRole("textbox", { name: "Name for Captain Hero" })).toHaveValue(
    "Captain Hero",
  );
  await character.getByRole("button", { name: "Crop", exact: true }).click();
  await page.getByRole("slider", { name: "Zoom", exact: true }).fill("2");
  await page.getByRole("slider", { name: "Horizontal position", exact: true }).fill("1");
  await page.getByRole("button", { name: "Done cropping", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
