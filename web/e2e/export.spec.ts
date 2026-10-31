import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const EXPECTED = {
  field: { width: 1600, height: 900, portraits: 22 + 8 + 5 },
  offense: { width: 1080, height: 1350, portraits: 11 + 8 + 5 },
  defense: { width: 1080, height: 1350, portraits: 11 + 8 + 5 },
  // 27 offense + 25 defense + 8 special teams + 5 staff; taller than 1350 to fit them all.
  depth: { width: 1080, portraits: 65 },
} as const;

test.use({ viewport: { width: 1440, height: 1000 } });

for (const [layout, want] of Object.entries(EXPECTED)) {
  test(`${layout} export: right size, every portrait drawn`, async ({ page }) => {
    await page.goto("/");
    // Render in the real browser straight from the app's modules (served by Vite).
    const got = await page.evaluate(async (layout) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { SEED_LISTS } = await load("/src/lists.ts");
      const { demoTeam } = await load("/src/demo.ts");
      const { renderTeam } = await load("/src/export/render.ts");
      const list = SEED_LISTS[0];
      const { canvas, portraits } = await renderTeam(
        demoTeam(list, { sections: true }),
        list,
        layout,
      );
      const ctx = canvas.getContext("2d")!;
      // A drawn portrait has detail; a blank or failed one is flat.
      const blank = portraits.filter((r: { x: number; y: number; w: number; h: number }) => {
        const d = ctx.getImageData(r.x + 2, r.y + 2, r.w - 4, r.h - 4).data;
        let sum = 0;
        let sq = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.3 * d[i]! + 0.59 * d[i + 1]! + 0.11 * d[i + 2]!;
          sum += l;
          sq += l * l;
        }
        return Math.sqrt(sq / n - (sum / n) ** 2) < 10;
      }).length;
      return { width: canvas.width, height: canvas.height, portraits: portraits.length, blank };
    }, layout);

    expect(got.width).toBe(want.width);
    if ("height" in want) expect(got.height).toBe(want.height);
    else expect(got.height).toBeGreaterThan(1350);
    expect(got.portraits).toBe(want.portraits);
    expect(got.blank).toBe(0);
  });
}

test("Download PNG saves a PNG of the chosen layout", async ({ page }) => {
  await page.goto("/?fill=demo&sections=1");
  await page.getByRole("combobox", { name: "Export" }).selectOption("depth");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("my-league-of-legends-team-depth-chart.png");
  const png = await readFile((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(1080); // IHDR width
  expect(png.readUInt32BE(20)).toBeGreaterThan(1350); // IHDR height
});
