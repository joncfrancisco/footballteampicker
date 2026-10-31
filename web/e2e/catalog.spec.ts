import { expect, test } from "@playwright/test";

test("home to list to builder, with one atlas and no API reads", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) reads.push(r.url());
  });
  await page.goto("/");
  await page.getByRole("link", { name: "League of Legends Champions" }).click();
  await expect(page).toHaveURL(/\/l\/demo-lol$/);
  await expect(page.getByRole("heading", { name: "League of Legends Champions" })).toBeVisible();
  await expect(page.locator(".list-portraits .sprite")).toHaveCount(173);
  await page.getByRole("link", { name: "Build a team" }).click();
  await expect(page.getByRole("textbox", { name: "Team name" })).toHaveValue(
    "My League of Legends Team",
  );
  expect(reads).toEqual([]);
});

test("search query survives navigation and refresh", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Pick a game" }).fill("League-of-Legends");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/browse\?q=League-of-Legends$/);
  await page.reload();
  await expect(page.getByRole("link", { name: "League of Legends Champions" })).toBeVisible();
  await page.getByRole("searchbox").fill("unknown game");
  await expect(page.getByText(/No lists match/)).toBeVisible();
});
