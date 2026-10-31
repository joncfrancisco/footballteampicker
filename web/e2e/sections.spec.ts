import { expect, test, type Locator, type Page } from "@playwright/test";

async function drag(page: Page, from: Locator, to: Locator) {
  await to.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(50);
}

const card = (page: Page, name: string) =>
  page.getByTestId("pool").getByRole("button", { name: new RegExp(`^${name}(,|$)`) });

test.use({ viewport: { width: 1440, height: 1400 } });

// Sharing arrives with #12; until then the draft is how a team round-trips.
test("enable both sections, fill them, reload: present; disable, reload: absent", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "+ Special teams" }).click();
  await page.getByRole("button", { name: "+ Staff" }).click();

  const qb = page.getByTestId("field-offense").locator('[data-slot="qb"]');
  await drag(page, card(page, "Ahri"), qb);
  // A field player dragged onto special teams keeps their spot.
  await drag(page, qb, page.getByTestId("special-teams").locator('[data-spot="KR1"]'));
  await drag(page, card(page, "Braum"), page.getByTestId("staff").locator('[data-spot="HC"]'));

  await expect(qb).toHaveAttribute("title", "QB · QB1: Ahri");
  await expect(page.getByTestId("special-teams").locator('[data-spot="KR1"]')).toHaveAccessibleName(
    "Ahri, special teams KR1",
  );

  await page.reload();
  await expect(page.getByTestId("staff").locator('[data-spot="HC"]')).toHaveAccessibleName(
    "Braum, staff HC",
  );
  await expect(page.getByTestId("special-teams").locator('[data-spot="KR1"]')).toHaveAccessibleName(
    "Ahri, special teams KR1",
  );

  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "✓ Special teams" }).click();
  await page.getByRole("button", { name: "✓ Staff" }).click();
  await page.reload();
  await expect(page.getByTestId("special-teams")).toHaveCount(0);
  await expect(page.getByTestId("staff")).toHaveCount(0);
  await expect(qb).toHaveAttribute("title", "QB · QB1: Ahri");
});
