import { expect, test } from "@playwright/test";

test("home page loads and reaches the local API", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Depth Chart" })).toBeVisible();
  await expect(page.getByText("API: ok")).toBeVisible();
});
