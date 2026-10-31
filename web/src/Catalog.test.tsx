import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { SEED_LISTS, summarize } from "./lists";

const summary = {
  ...summarize(SEED_LISTS[0]!),
  id: "public1234",
  title: "Heroes",
  ip: "Test: Gáme!",
  atlas: { ...SEED_LISTS[0]!.atlas, src: "/m/a/test.webp" },
  createdAt: "2026-10-31",
  updatedAt: "2026-10-31",
};
beforeEach(() => {
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("discovery", () => {
  it("shows seeds first and searches normalized games and titles without another request", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ updatedAt: "", lists: [summary] })));
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState(null, "", "/browse");
    render(<App />);
    await screen.findByRole("link", { name: "Heroes" });
    expect(screen.getAllByRole("article")[0]).toHaveTextContent("League of Legends");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "testgame" } });
    expect(
      screen.queryByRole("link", { name: "League of Legends Champions" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Heroes" })).toHaveAttribute("href", "/l/public1234");
    expect(location.search).toBe("?q=testgame");
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no matches" } });
    expect(screen.getByText(/No lists match/)).toBeInTheDocument();
  });

  it("keeps the seed usable when browse fails, and retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 503 }))
        .mockResolvedValueOnce(new Response("", { status: 404 })),
    );
    render(<App />);
    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: "League of Legends Champions" })).toHaveAttribute(
      "href",
      "/l/demo-lol",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText(/No community lists yet/);
  });

  it("loads a published unlisted list directly, without exposing edit tokens", async () => {
    const seed = SEED_LISTS[0]!;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...seed,
            id: "unlisted01",
            version: 1,
            visibility: "unlisted",
            createdAt: "",
            updatedAt: "",
            atlas: summary.atlas,
          }),
        ),
      ),
    );
    window.history.replaceState(null, "", "/l/unlisted01");
    render(<App />);
    expect(await screen.findByRole("link", { name: "Build a team" })).toHaveAttribute(
      "href",
      "/build/unlisted01",
    );
    expect(screen.getByRole("link", { name: "Remix list" })).toHaveAttribute(
      "href",
      "/new?remix=unlisted01",
    );
  });

  it("shows a missing page for hidden lists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    window.history.replaceState(null, "", "/l/missing");
    render(<App />);
    await screen.findByRole("heading", { name: "Page not found" });
  });

  it("finds owned lists from local storage and keeps tokens out of links", async () => {
    localStorage.setItem("ftp:edit:demo-lol", "private-edit-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    render(<App />);
    const mine = screen.getByRole("heading", { name: "My lists" }).parentElement!;
    expect(
      await within(mine).findByRole("link", { name: "League of Legends Champions" }),
    ).toHaveAttribute("href", "/l/demo-lol/edit");
    expect(document.body.innerHTML).not.toContain("private-edit-token");
  });
});
