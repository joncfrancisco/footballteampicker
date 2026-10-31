import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

const refs = (side: "offense" | "defense") =>
  [...screen.getByTestId(`field-${side}`).querySelectorAll(".slot")].map(
    (el) => (el as HTMLElement).dataset.ref,
  );

afterEach(() => window.history.replaceState(null, "", "/"));

describe("App", () => {
  it("starts on offense in 11 Singleback with a default title and the disclaimer", () => {
    render(<App />);
    expect(screen.getByRole("textbox", { name: "Team name" })).toHaveValue(
      "My League of Legends Team",
    );
    expect(screen.getByRole("combobox", { name: "Offense" })).toHaveValue("11-singleback");
    expect(refs("offense")).toHaveLength(11);
    expect(refs("offense")).toContain("WR3");
    expect(screen.getByText(/Legal Jibber Jabber/)).toBeInTheDocument();
  });

  it("refills the field when the formation changes", () => {
    render(<App />);
    fireEvent.change(screen.getByRole("combobox", { name: "Offense" }), {
      target: { value: "12-ace" },
    });
    expect(refs("offense")).toContain("TE2");
    expect(refs("offense")).not.toContain("WR3");
  });

  it("toggles the QB between under center and shotgun", () => {
    render(<App />);
    const qb = () =>
      (screen.getByTestId("field-offense").querySelector('[data-slot="qb"]') as HTMLElement).style
        .top;
    const before = qb();
    fireEvent.click(screen.getByRole("button", { name: "Under center" }));
    expect(screen.getByRole("button", { name: "Shotgun" })).toHaveAttribute("aria-pressed", "true");
    expect(qb()).not.toBe(before);
  });

  it("offers the defensive formations for the team's front", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Defense" }));
    const picker = screen.getByRole("combobox", { name: "Defense" });
    expect(within(picker).getAllByRole("option")).toHaveLength(4);

    fireEvent.change(screen.getByRole("combobox", { name: "Front" }), {
      target: { value: "3-4" },
    });
    expect(screen.getByRole("combobox", { name: "Defense" })).toHaveValue("34-okie");
    expect(
      within(screen.getByRole("combobox", { name: "Defense" })).getAllByRole("option"),
    ).toHaveLength(3);
    expect(refs("defense")).toContain("NT1");
  });

  it("shows portraits and names for filled slots (?fill=demo)", () => {
    window.history.replaceState(null, "", "/?fill=demo");
    render(<App />);
    const qb = screen.getByTestId("field-offense").querySelector('[data-slot="qb"]')!;
    expect(qb).toHaveClass("filled");
    expect(qb.querySelector(".sprite")).not.toBeNull();
    expect(qb).toHaveTextContent("Aatrox");
  });
});
