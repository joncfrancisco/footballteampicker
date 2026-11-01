import { SPORTS } from "@ftp/shared";
import { expect, test } from "@playwright/test";

/** Every formation of every sport besides football (formations.spec.ts) fits phone and desktop. */
const SIZES = [
  { name: "phone", width: 375, height: 812 },
  { name: "desktop", width: 1440, height: 1000 },
];

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const sport of SPORTS.filter((s) => s.id !== "football"))
      for (const f of sport.formations) {
        const unit = sport.units.find((u) => u.id === f.unit)!;
        test(`${sport.id} ${f.id} fits, every slot tappable`, async ({ page }, info) => {
          await page.goto(`/build/demo-lol?sport=${sport.id}&fill=demo`);
          if (f.variant)
            await page
              .getByRole("combobox", { name: unit.variantLabel ?? unit.name })
              .selectOption(f.variant);
          const tab = page.getByRole("tab", { name: unit.name });
          if (await tab.isVisible()) await tab.click();
          await page.getByRole("combobox", { name: unit.name }).selectOption(f.id);

          const slots = page.getByTestId(`field-${f.unit}`).locator(".slot");
          await expect(slots).toHaveCount(f.slots.length);
          const boxes = await Promise.all(
            (await slots.all()).map(async (s) => ({
              ref: (await s.getAttribute("data-ref"))!,
              ...(await s.boundingBox())!,
            })),
          );
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
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(size.width);
          await info.attach(`${sport.id}-${f.id}-${size.name}`, {
            body: await page.getByRole("main").screenshot(),
            contentType: "image/png",
          });
        });
      }
  });
}

test("a soccer team shares and its link shows the pitch", async ({ page }) => {
  await page.goto("/build/demo-lol?sport=soccer&fill=demo");
  await page.getByRole("button", { name: "Share team" }).click();
  const link = page.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue(/\/t\/[A-Za-z0-9]{10}$/);
  await page.goto(await link.inputValue());
  await expect(page.getByTestId("sport-badge")).toHaveText("Soccer");
  await expect(page.getByTestId("field-squad").locator(".slot.filled")).toHaveCount(11);
});
