import { devices, expect, test, type Locator, type Page } from "@playwright/test";

async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(50); // dnd-kit swallows the click right after a drop
}

const card = (page: Page, name: string) =>
  page.getByTestId("pool").getByRole("button", { name: new RegExp(`^${name}(,|$)`) });
const slot = (page: Page, side: string, id: string) =>
  page.getByTestId(`field-${side}`).locator(`[data-slot="${id}"]`);

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("drag from the pool onto the field, then back to the pool", async ({ page }) => {
    await page.goto("/");
    await drag(page, card(page, "Ahri"), slot(page, "offense", "qb"));
    await expect(slot(page, "offense", "qb")).toHaveAttribute("title", "QB · QB1: Ahri");
    await expect(card(page, "Ahri")).toHaveAccessibleName("Ahri, plays offense");

    await drag(page, slot(page, "offense", "qb"), page.getByTestId("pool").locator(".pool-count"));
    await expect(slot(page, "offense", "qb")).not.toHaveClass(/filled/);
  });

  test("a drop onto a filled slot replaces; slot to slot swaps", async ({ page }) => {
    await page.goto("/");
    await drag(page, card(page, "Ahri"), slot(page, "offense", "qb"));
    await drag(page, card(page, "Annie"), slot(page, "offense", "qb"));
    await expect(slot(page, "offense", "qb")).toHaveAttribute("title", "QB · QB1: Annie");
    await expect(card(page, "Ahri")).toHaveAccessibleName("Ahri");

    await drag(page, card(page, "Ashe"), slot(page, "offense", "x"));
    await drag(page, slot(page, "offense", "x"), slot(page, "offense", "qb"));
    await expect(slot(page, "offense", "qb")).toHaveAttribute("title", "QB · QB1: Ashe");
    await expect(slot(page, "offense", "x")).toHaveAttribute("title", "X · WR1: Annie");
  });

  test("a one-way player dropped on the other side snaps back with the reason", async ({
    page,
  }) => {
    await page.goto("/");
    await drag(page, card(page, "Ahri"), slot(page, "offense", "qb"));
    await drag(page, card(page, "Ahri"), slot(page, "defense", "mlb"));
    await expect(page.getByText("Ahri isn't a two-way player")).toBeVisible();
    await expect(slot(page, "defense", "mlb")).not.toHaveClass(/filled/);
    await expect(slot(page, "offense", "qb")).toHaveAttribute("title", "QB · QB1: Ahri");
  });

  test("keyboard only: Enter to select, Enter to place; Space and arrows to drag", async ({
    page,
  }) => {
    await page.goto("/");
    await card(page, "Ahri").focus();
    await page.keyboard.press("Enter");
    await slot(page, "offense", "qb").focus();
    await page.keyboard.press("Enter");
    await expect(slot(page, "offense", "qb")).toHaveAttribute("title", "QB · QB1: Ahri");

    // Keyboard drag in the depth chart: QB1 one step right is QB2.
    await page.getByRole("button", { name: "Depth chart" }).press("Enter");
    const qb1 = page.getByTestId("depth-offense").locator('[data-spot="QB1"]');
    // Wait for dnd-kit's screen-reader announcements between keys: the drop targets are
    // measured just after pick-up.
    const live = page.locator('[id^="DndLiveRegion"]');
    await qb1.focus();
    await page.keyboard.press("Space");
    await expect(live).toContainText("Ahri is over offense QB1");
    await page.keyboard.press("ArrowRight");
    await expect(live).toContainText("Ahri is over offense QB2");
    await page.keyboard.press("Space");
    await expect(
      page.getByTestId("depth-offense").locator('[data-spot="QB2"]'),
    ).toHaveAccessibleName("Ahri, offense QB2");
  });

  test("the draft survives a reload", async ({ page }) => {
    await page.goto("/");
    await drag(page, card(page, "Ahri"), slot(page, "offense", "qb"));
    await page.reload();
    await expect(slot(page, "offense", "qb")).toHaveAttribute("title", "QB · QB1: Ahri");
  });
});

// Pixel 7 emulation (touch, mobile viewport), minus the browser choice, which can't vary per group.
const { defaultBrowserType, ...pixel7 } = devices["Pixel 7"];

test.describe("phone (touch)", () => {
  test.use(pixel7);

  test("tap a character, tap a slot", async ({ page }) => {
    await page.goto("/");
    await card(page, "Ahri").tap();
    await expect(page.getByText("Ahri selected: tap a spot to place them.")).toBeVisible();
    await slot(page, "offense", "qb").tap();
    await expect(slot(page, "offense", "qb")).toHaveAttribute("title", "QB · QB1: Ahri");

    await slot(page, "offense", "qb").tap();
    await page.getByRole("button", { name: "Remove" }).tap();
    await expect(slot(page, "offense", "qb")).not.toHaveClass(/filled/);
  });
});
