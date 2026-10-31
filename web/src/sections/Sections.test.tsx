import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

afterEach(() => vi.restoreAllMocks());

const pool = () => screen.getByTestId("pool");
const card = (name: string) => within(pool()).getByRole("button", { name: new RegExp(`^${name}`) });
const tile = (section: string, spot: string) =>
  screen.getByTestId(section).querySelector(`[data-spot="${spot}"]`) as HTMLElement;
const slot = (id: string) =>
  screen.getByTestId("field-offense").querySelector(`[data-slot="${id}"]`) as HTMLElement;
const toggle = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));

describe("optional sections", () => {
  it("are off by default and appear when turned on", () => {
    render(<App />);
    expect(screen.queryByTestId("staff")).toBeNull();
    expect(screen.queryByTestId("special-teams")).toBeNull();
    toggle("Special teams");
    toggle("Staff");
    expect(screen.getByRole("button", { name: "✓ Staff" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("special-teams").querySelectorAll("[data-spot]")).toHaveLength(8);
    expect(screen.getByTestId("staff").querySelectorAll("[data-spot]")).toHaveLength(5);
  });

  it("special teams play on top of a player's spot; KR + PR is fine", () => {
    render(<App />);
    toggle("Special teams");
    fireEvent.click(card("Ahri"));
    fireEvent.click(slot("x"));
    fireEvent.click(card("Ahri"));
    fireEvent.click(tile("special-teams", "KR1"));
    fireEvent.click(card("Ahri"));
    fireEvent.click(tile("special-teams", "PR1"));
    expect(slot("x")).toHaveClass("filled");
    expect(tile("special-teams", "KR1")).toHaveAccessibleName("Ahri, special teams KR1");
    expect(tile("special-teams", "PR1")).toHaveAccessibleName("Ahri, special teams PR1");
    expect(card("Ahri")).toHaveAccessibleName("Ahri, plays offense and special teams");
  });

  it("naming a player to staff takes them off the roster, with a notice", () => {
    render(<App />);
    toggle("Staff");
    fireEvent.click(card("Ahri"));
    fireEvent.click(slot("qb"));
    fireEvent.click(card("Ahri"));
    fireEvent.click(tile("staff", "HC"));
    expect(screen.getByText("Ahri moved to staff and off the roster")).toBeInTheDocument();
    expect(slot("qb")).not.toHaveClass("filled");
    expect(card("Ahri")).toHaveAccessibleName("Ahri, on staff");

    fireEvent.click(card("Ahri"));
    fireEvent.click(slot("qb"));
    expect(screen.getByText("Ahri is on staff and can't play")).toBeInTheDocument();
  });

  it("asks before turning off a section with filled spots", () => {
    render(<App />);
    toggle("Staff");
    fireEvent.click(card("Ahri"));
    fireEvent.click(tile("staff", "GM"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    toggle("Staff");
    expect(confirm).toHaveBeenCalledWith("Remove staff? 1 filled spot will be cleared.");
    expect(screen.getByTestId("staff")).toBeInTheDocument();
    confirm.mockReturnValue(true);
    toggle("Staff");
    expect(screen.queryByTestId("staff")).toBeNull();
  });

  it("shows staff at the top and special teams at the bottom of the depth chart", () => {
    render(<App />);
    toggle("Special teams");
    toggle("Staff");
    fireEvent.click(screen.getByRole("button", { name: "Depth chart" }));
    const tables = [...screen.getByTestId("depth-chart").querySelectorAll("table")].map(
      (t) => t.dataset.testid,
    );
    expect(tables).toEqual(["depth-staff", "depth-offense", "depth-defense", "depth-specialTeams"]);
  });

  it("filters the pool to characters available for special teams", () => {
    render(<App />);
    toggle("Special teams");
    fireEvent.click(card("Ahri"));
    fireEvent.click(tile("special-teams", "K1"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Available for special teams" }));
    expect(within(pool()).queryByRole("button", { name: /^Ahri/ })).toBeNull();
    expect(card("Akali")).toBeInTheDocument();
  });
});
