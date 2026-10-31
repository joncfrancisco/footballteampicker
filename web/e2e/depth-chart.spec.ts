import { expect, test, type Locator, type Page } from "@playwright/test";

async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // Past the 4px activation distance, then onto the target in steps so dnd-kit sees it.
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  // dnd-kit swallows the click that follows a drop; a person never clicks that fast.
  await page.waitForTimeout(50);
}

for (const width of [1440, 375]) {
  test(`promote WR4 to WR2 in the depth chart and the field's Z receiver changes (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?fill=demo");
    await page.getByRole("button", { name: "Depth chart" }).click();

    const offense = page.getByTestId("depth-offense");
    const wr4 = offense.locator('[data-spot="WR4"] button');
    const name = (await wr4.getAttribute("aria-label"))!.split(",")[0]!;
    const oldWr2 = (await offense
      .locator('[data-spot="WR2"] button')
      .getAttribute("aria-label"))!.split(",")[0]!;

    await drag(page, wr4, offense.locator('[data-spot="WR2"]'));

    await expect(offense.locator('[data-spot="WR2"] button')).toHaveAttribute(
      "aria-label",
      `${name}, offense WR2`,
    );
    // Reorder, not swap: the old WR2 slides down to WR3.
    await expect(offense.locator('[data-spot="WR3"] button')).toHaveAttribute(
      "aria-label",
      `${oldWr2}, offense WR3`,
    );

    await page.getByRole("button", { name: "Field" }).click();
    await expect(page.getByTestId("field-offense").locator('[data-slot="z"]')).toHaveAttribute(
      "title",
      `Z · WR2: ${name}`,
    );
  });
}

test("drag a defender to another row swaps them", async ({ page }) => {
  // Tall enough that no target sits near an edge, where dnd-kit auto-scrolls mid-drag.
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/?fill=demo");
  await page.getByRole("button", { name: "Depth chart" }).click();
  const defense = page.getByTestId("depth-defense");
  const label = async (spot: string) =>
    (await defense.locator(`[data-spot="${spot}"] button`).getAttribute("aria-label"))!.split(
      ",",
    )[0];
  const [ss, fs] = [await label("SS1"), await label("FS1")];

  await drag(
    page,
    defense.locator('[data-spot="SS1"] button'),
    defense.locator('[data-spot="FS1"]'),
  );

  await expect(defense.locator('[data-spot="FS1"] button')).toHaveAttribute(
    "aria-label",
    `${ss}, defense FS1`,
  );
  await expect(defense.locator('[data-spot="SS1"] button')).toHaveAttribute(
    "aria-label",
    `${fs}, defense SS1`,
  );
});
