import { FORMATIONS } from "@ftp/shared";
import { expect, test, type Page } from "@playwright/test";

const SIZES = [
  { name: "phone", width: 375, height: 812 },
  { name: "desktop", width: 1440, height: 1000 },
];

type Box = { ref: string; x: number; y: number; width: number; height: number };

async function slotBoxes(page: Page, side: string): Promise<Box[]> {
  const slots = page.getByTestId(`field-${side}`).locator(".slot");
  await expect(slots).toHaveCount(11);
  return Promise.all(
    (await slots.all()).map(async (s) => ({
      ref: (await s.getAttribute("data-ref"))!,
      ...(await s.boundingBox())!,
    })),
  );
}

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const f of FORMATIONS) {
      test(`${f.id} fits, every slot tappable`, async ({ page }, info) => {
        await page.goto("/?fill=demo");
        if (f.side === "defense" && f.front === "3-4") {
          await page.getByRole("combobox", { name: "Front" }).selectOption("3-4");
        }
        const tab = page.getByRole("tab", { name: f.side === "offense" ? "Offense" : "Defense" });
        if (await tab.isVisible()) await tab.click();
        await page
          .getByRole("combobox", { name: f.side === "offense" ? "Offense" : "Defense" })
          .selectOption(f.id);

        const boxes = await slotBoxes(page, f.side);
        for (const b of boxes) {
          expect(b.width, b.ref).toBeGreaterThanOrEqual(44);
          expect(b.height, b.ref).toBeGreaterThanOrEqual(44);
          expect(b.x, b.ref).toBeGreaterThanOrEqual(0);
          expect(b.x + b.width, b.ref).toBeLessThanOrEqual(size.width);
        }
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            const apart =
              a.x + a.width <= b.x + 0.5 ||
              b.x + b.width <= a.x + 0.5 ||
              a.y + a.height <= b.y + 0.5 ||
              b.y + b.height <= a.y + 0.5;
            expect(apart, `${a.ref} overlaps ${b.ref}`).toBe(true);
          }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          size.width,
        );

        await info.attach(`${f.id}-${size.name}`, {
          body: await page.getByRole("main").screenshot(),
          contentType: "image/png",
        });
      });
    }
  });
}

test("both sides face each other on a wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/build/demo-lol");
  const defense = (await page.getByTestId("field-defense").boundingBox())!;
  const offense = (await page.getByTestId("field-offense").boundingBox())!;
  expect(defense.y + defense.height).toBeCloseTo(offense.y, 0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});
