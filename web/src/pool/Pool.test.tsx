import { beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";

const pool = () => screen.getByTestId("pool");
const card = (name: string) => within(pool()).getByRole("button", { name: new RegExp(`^${name}`) });
const slot = (side: string, id: string) =>
  screen.getByTestId(`field-${side}`).querySelector(`[data-slot="${id}"]`) as HTMLElement;

describe("Pool", () => {
  it("lists every character and filters by search, tag and unused", () => {
    render(<App />);
    expect(within(pool()).getByText("173 characters")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search characters" }), {
      target: { value: "ah" },
    });
    expect(within(pool()).getByText(/of 173/)).toBeInTheDocument();
    expect(card("Ahri")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search characters" }), {
      target: { value: "" },
    });

    fireEvent.click(within(pool()).getByRole("button", { name: "Marksman" }));
    expect(card("Ashe")).toBeInTheDocument();
    expect(within(pool()).queryByRole("button", { name: /^Ahri/ })).toBeNull();
    fireEvent.click(within(pool()).getByRole("button", { name: "Marksman" }));

    fireEvent.click(card("Ahri"));
    fireEvent.click(slot("offense", "qb"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Unused" }));
    expect(within(pool()).queryByRole("button", { name: /^Ahri/ })).toBeNull();
  });

  it("tap a card, tap a slot: places them, marks where they play", () => {
    render(<App />);
    fireEvent.click(card("Ahri"));
    expect(screen.getByText("Ahri selected: tap a spot to place them.")).toBeInTheDocument();
    fireEvent.click(slot("offense", "qb"));
    expect(slot("offense", "qb")).toHaveAttribute("title", "QB · QB1: Ahri");
    expect(card("Ahri")).toHaveAccessibleName("Ahri, plays offense");
    expect(within(card("Ahri")).getByText("O")).toBeInTheDocument();
  });

  it("refuses a one-way player on the other side, with the reason", () => {
    render(<App />);
    fireEvent.click(card("Ahri"));
    fireEvent.click(slot("offense", "qb"));
    fireEvent.click(screen.getByRole("tab", { name: "Defense" }));
    fireEvent.click(card("Ahri"));
    fireEvent.click(slot("defense", "mlb"));
    expect(screen.getByText("Ahri isn't a two-way player")).toBeInTheDocument();
    expect(slot("defense", "mlb")).not.toHaveClass("filled");
  });

  it("tap a filled slot to select it, then Remove sends them back to the pool", () => {
    render(<App />);
    fireEvent.click(card("Ahri"));
    fireEvent.click(slot("offense", "qb"));
    fireEvent.click(slot("offense", "qb"));
    expect(screen.getByText("Ahri (QB1) selected: tap a spot to move them.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(slot("offense", "qb")).not.toHaveClass("filled");
  });

  it("tap a filled slot, then another slot: moves them", () => {
    render(<App />);
    fireEvent.click(card("Ahri"));
    fireEvent.click(slot("offense", "qb"));
    fireEvent.click(slot("offense", "qb"));
    fireEvent.click(slot("offense", "x"));
    expect(slot("offense", "x")).toHaveAttribute("title", "X · WR1: Ahri");
    expect(slot("offense", "qb")).not.toHaveClass("filled");
  });

  it("auto-fill, clear and randomize", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-fill depth" }));
    expect(screen.getByTestId("field-offense").querySelectorAll(".slot.filled")).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "Clear offense" }));
    expect(screen.getByTestId("field-offense").querySelectorAll(".slot.filled")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Randomize" }));
    expect(screen.getByTestId("field-offense").querySelectorAll(".slot.filled")).toHaveLength(11);
  });

  it("keeps the draft across a reload", () => {
    const { unmount } = render(<App />);
    fireEvent.click(card("Ahri"));
    fireEvent.click(slot("offense", "qb"));
    fireEvent.change(screen.getByRole("textbox", { name: "Team name" }), {
      target: { value: "Mid Lane Monsters" },
    });
    unmount();
    render(<App />);
    expect(slot("offense", "qb")).toHaveAttribute("title", "QB · QB1: Ahri");
    expect(screen.getByRole("textbox", { name: "Team name" })).toHaveValue("Mid Lane Monsters");
  });

  it("ignores a draft that breaks the rules", () => {
    localStorage.setItem(
      "ftp:draft:demo-lol",
      JSON.stringify({ listId: "demo-lol", title: "x", offense: {}, defense: {} }),
    );
    render(<App />);
    expect(screen.getByRole("textbox", { name: "Team name" })).toHaveValue(
      "My League of Legends Team",
    );
  });
});

beforeEach(() => window.history.replaceState(null, "", "/build/demo-lol"));
afterEach(() => window.history.replaceState(null, "", "/"));
