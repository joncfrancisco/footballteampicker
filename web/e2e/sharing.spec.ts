import { expect, test } from "@playwright/test";
import { newTeam, setSection } from "@ftp/shared";
import lol from "../../seed/league-of-legends/list.json" with { type: "json" };

const HUMAN = { "x-turnstile-token": "XXXX.DUMMY.TOKEN.XXXX" };

test("share, deduplicate, open in a fresh browser, switch formations, and remix", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    // The local API still verifies Cloudflare's documented test token server-side.
    window.turnstile = {
      render: (_node, options) => {
        setTimeout(() => (options.callback as (token: string) => void)("XXXX.DUMMY.TOKEN.XXXX"), 0);
        return "test-widget";
      },
      remove: () => {},
    };
  });
  let writes = 0;
  await page.route("**/api/teams", async (route) => {
    writes++;
    if (writes === 1) await route.fulfill({ status: 429, json: { error: "rate_limited" } });
    else await route.continue();
  });
  await page.goto("/?fill=demo&sections=1");
  await page.getByRole("button", { name: "Share team", exact: true }).click();
  const link = page.getByRole("textbox", { name: "Share link", exact: true });
  await expect(link).toHaveValue(/\/t\/[A-Za-z0-9]{10}$/, { timeout: 20000 });
  const url = await link.inputValue();
  await page.getByRole("button", { name: "Share team", exact: true }).click();
  expect(writes).toBe(2); // one transient failure, one successful save, zero duplicate saves
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const viewer = await context.newPage();
  const reads: string[] = [];
  viewer.on("request", (r) => {
    if (r.url().includes("/api/")) reads.push(r.url());
  });
  await viewer.goto(url);
  await expect(viewer.getByTestId("field-offense").locator('[data-slot="qb"]')).toHaveAttribute(
    "title",
    /Aatrox/,
  );
  await expect(viewer.getByTestId("pool")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Auto-fill depth" })).toHaveCount(0);
  await expect(viewer.getByTestId("staff")).toBeVisible();
  await expect(viewer.getByTestId("special-teams")).toBeVisible();
  await viewer.getByRole("combobox", { name: "Defense", exact: true }).selectOption("43-dime");
  await expect(viewer.getByTestId("field-defense").locator('[data-ref="NB1"]')).toHaveCount(1);
  await expect(viewer.getByTestId("field-defense").locator('[data-ref="DB1"]')).toHaveCount(1);
  await viewer.getByRole("button", { name: "Depth chart", exact: true }).click();
  await expect(viewer.getByTestId("depth-staff")).toBeVisible();
  await expect(viewer.getByTestId("depth-specialTeams")).toBeVisible();
  const download = viewer.waitForEvent("download");
  await viewer.getByRole("button", { name: "Download PNG" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  expect(reads).toEqual([]);
  await viewer.getByRole("link", { name: "Remix this team" }).click();
  await expect(viewer.getByTestId("pool")).toBeVisible();
  await expect(viewer.getByRole("textbox", { name: "Team name" })).toHaveValue(
    "My League of Legends Team",
  );
  await context.close();
});

test("exhausted sharing retries keep the draft and image export available", async ({ page }) => {
  await page.addInitScript(() => {
    window.turnstile = {
      render: (_node, options) => {
        setTimeout(() => (options.callback as (token: string) => void)("XXXX.DUMMY.TOKEN.XXXX"), 0);
        return "test-widget";
      },
      remove: () => {},
    };
  });
  let attempts = 0;
  await page.route("**/api/teams", async (route) => {
    attempts++;
    await route.fulfill({ status: 503, json: { error: "writes_unavailable" } });
  });
  await page.goto("/build/demo-lol");
  await page.getByRole("textbox", { name: "Team name" }).fill("Keep my draft");
  await page.getByRole("button", { name: "Share team", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Sharing is paused", { timeout: 15000 });
  expect(attempts).toBe(4);
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Team name" })).toHaveValue("Keep my draft");
});

test("saved snapshots survive list edits; remix handles removed and former two-way players", async ({
  page,
  request,
}) => {
  const characters = lol.characters.slice(0, 30).map((c) => ({ ...c, twoWay: true }));
  const input = {
    title: "Snapshot roster",
    ip: "Test game",
    atlas: { key: "m/a/test.webp", ...lol.atlas, count: lol.characters.length },
    characters,
  };
  // This API caps custom atlas counts at 150; indices in this fixture are in the first 30.
  input.atlas.count = 30;
  const created = await request.post("/api/lists", { headers: HUMAN, data: input });
  expect(created.ok()).toBeTruthy();
  const { id, editToken } = (await created.json()) as { id: string; editToken: string };
  const team = setSection(
    setSection(newTeam({ id, ip: "Test game" }), "staff", true),
    "specialTeams",
    true,
  );
  const first = characters[0]!;
  const removed = characters[1]!;
  team.offense.depth.QB![0] = first.id;
  team.offense.depth.RB![1] = removed.id;
  team.defense.depth.FS![0] = first.id;
  team.specialTeams!.KR![0] = first.id;
  team.staff!.HC = characters[2]!.id;
  const saved = await request.post("/api/teams", {
    headers: HUMAN,
    data: { ...team, listVersion: 1 },
  });
  expect(saved.ok()).toBeTruthy();
  const savedId = ((await saved.json()) as { id: string }).id;
  const update = await request.put(`/api/lists/${id}`, {
    headers: { ...HUMAN, authorization: `Bearer ${editToken}` },
    data: {
      ...input,
      characters: characters
        .filter((c) => c.id !== removed.id)
        .map((c) => ({ ...c, name: "Renamed", twoWay: false })),
    },
  });
  expect(update.ok()).toBeTruthy();
  await page.goto(`/t/${savedId}?view=depth`);
  await expect(page.getByTestId("depth-offense").locator('[data-spot="QB1"]')).toHaveText(
    new RegExp(first.name),
  );
  await expect(page.getByTestId("depth-defense").locator('[data-spot="FS1"]')).toHaveText(
    new RegExp(first.name),
  );
  await expect(page.getByTestId("depth-offense").locator('[data-spot="RB2"]')).toHaveText(
    new RegExp(removed.name),
  );
  await page.getByRole("link", { name: "Remix this team" }).click();
  await expect(page.getByText(/no longer two-way/)).toBeVisible();
  await expect(page.getByText(/Missing from the current list/)).toBeVisible();
  await page.getByRole("button", { name: "Depth chart", exact: true }).click();
  await expect(page.getByTestId("depth-offense").locator('[data-spot="QB1"]')).toHaveText(
    /Renamed/,
  );
  await expect(page.getByTestId("depth-defense").locator('[data-spot="FS1"]')).not.toHaveClass(
    /filled/,
  );
  await expect(page.getByTestId("depth-offense").locator('[data-spot="RB2"]')).not.toHaveClass(
    /filled/,
  );
});
