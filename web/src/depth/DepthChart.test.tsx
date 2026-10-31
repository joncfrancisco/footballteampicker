import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";

afterEach(() => window.history.replaceState(null, "", "/"));

function openDepthChart() {
  window.history.replaceState(null, "", "/?fill=demo");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Depth chart" }));
}

const cell = (side: string, spot: string) =>
  screen.getByTestId(`depth-${side}`).querySelector(`[data-spot="${spot}"]`) as HTMLElement;

describe("DepthChart", () => {
  it("shows every row of both sides with WR going six deep", () => {
    openDepthChart();
    const offense = screen.getByTestId("depth-offense");
    expect(
      within(offense)
        .getAllByRole("rowheader")
        .map((th) => th.textContent),
    ).toEqual(["QB", "RB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"]);
    expect(offense.querySelectorAll("[data-spot]")).toHaveLength(27);
    expect(screen.getByTestId("depth-defense").querySelectorAll("[data-spot]")).toHaveLength(25);
    expect(cell("offense", "WR6")).toHaveClass("filled");
  });

  it("highlights the current formation's starters and explains why", () => {
    openDepthChart();
    expect(cell("offense", "WR3")).toHaveClass("starter");
    expect(cell("offense", "TE2")).not.toHaveClass("starter");
    expect(screen.getByTestId("depth-offense")).toHaveTextContent(
      "Highlighted: starters in 11 · Singleback",
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Offense" }), {
      target: { value: "12-ace" },
    });
    expect(cell("offense", "WR3")).not.toHaveClass("starter");
    expect(cell("offense", "TE2")).toHaveClass("starter");
    expect(cell("offense", "TE2")).toHaveAttribute("title", "TE2: starter in 12 · Singleback Ace");
  });

  it("keeps players across a front switch and reports who went to the pool", () => {
    openDepthChart();
    const ldt = cell("defense", "LDT1").textContent;
    fireEvent.change(screen.getByRole("combobox", { name: "Front" }), {
      target: { value: "3-4" },
    });
    expect(screen.getByTestId("depth-defense")).toHaveTextContent("Defense (3-4)");
    expect(cell("defense", "NT1").textContent).toBe(ldt);
    // 3-4 has no RDT row, so both RDTs go to the pool.
    expect(screen.getByText("2 players moved to the pool")).toBeInTheDocument();
  });
});
