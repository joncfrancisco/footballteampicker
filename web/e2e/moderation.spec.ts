import { expect, test } from "@playwright/test";
import lol from "../../seed/league-of-legends/list.json" with { type: "json" };

const HUMAN = { "x-turnstile-token": "XXXX.DUMMY.TOKEN.XXXX" };
test("report a list and read the policy", async ({ page }) => {
  await page.addInitScript(() => {
    window.turnstile = {
      render: (_node, options) => {
        setTimeout(() => (options.callback as (token: string) => void)("XXXX.DUMMY.TOKEN.XXXX"), 0);
        return "test";
      },
      remove: () => {},
    };
  });
  await page.goto("/l/demo-lol");
  await page.getByRole("link", { name: "Report", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Describe the problem" })
    .fill("Please review the attribution for this list.");
  await page.getByRole("button", { name: "Send report", exact: true }).click();
  await expect(
    page.getByText("Thank you. Your report was received and will be reviewed."),
  ).toBeVisible();
  await page.getByRole("link", { name: "About & content rules" }).click();
  await expect(page.getByRole("heading", { name: "Content rules" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "contact the site owner", exact: true }),
  ).toHaveAttribute("href", /mailto:/);
});

test("three distinct reports hide a public list and remove it from browse", async ({
  request,
  browser,
}) => {
  const create = await request.post("/api/lists", {
    headers: HUMAN,
    data: {
      title: "Moderation test",
      ip: "Test",
      visibility: "public",
      seedId: lol.id,
      atlas: { ...lol.atlas, key: `m/seeds/${lol.id}/${lol.atlas.src}` },
      characters: lol.characters.slice(0, 11),
    },
  });
  expect(create.ok()).toBeTruthy();
  const { id } = (await create.json()) as { id: string };
  for (const ip of ["198.51.100.10", "198.51.100.11", "198.51.100.12"]) {
    const report = await request.post("/api/reports", {
      headers: { ...HUMAN, "x-forwarded-for": ip },
      data: { targetType: "list", targetId: id, reason: "Prohibited content" },
    });
    expect(report.status()).toBe(204);
  }
  const viewer = await browser.newPage();
  await viewer.goto(`/l/${id}`);
  await expect(viewer.getByRole("heading", { name: "Page not found" })).toBeVisible();
  const index = await request.get("/m/browse/index.json");
  expect(((await index.json()) as { lists: { id: string }[] }).lists.some((l) => l.id === id)).toBe(
    false,
  );
  await viewer.close();
});
