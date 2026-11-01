import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

const refs = (side: "offense" | "defense") =>
  [...screen.getByTestId(`field-${side}`).querySelectorAll(".slot")].map(
    (el) => (el as HTMLElement).dataset.ref,
  );

afterEach(() => window.history.replaceState(null, "", "/"));
beforeEach(() => window.history.replaceState(null, "", "/build/demo-lol"));

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

describe("sports (#44)", () => {
  const pick = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));

  it("switches sport, keeping a draft per sport and the sport in the URL", () => {
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "Team name" }), {
      target: { value: "Football draft" },
    });
    pick("Soccer");
    expect(location.search).toBe("?sport=soccer");
    expect(screen.getByRole("combobox", { name: "Squad" })).toHaveValue("soccer-433");
    expect(screen.getByTestId("field-squad").querySelectorAll(".slot")).toHaveLength(11);
    expect(screen.getByRole("button", { name: "Pitch" })).toBeInTheDocument();
    expect(screen.getByTestId("sport-badge")).toHaveTextContent("Soccer");
    pick("Football");
    expect(location.search).toBe("");
    expect(screen.getByRole("textbox", { name: "Team name" })).toHaveValue("Football draft");
  });

  it("opens the sport named in the URL", () => {
    window.history.replaceState(null, "", "/build/demo-lol?sport=soccer");
    render(<App />);
    expect(screen.getByRole("radio", { name: "Soccer" })).toHaveAttribute("aria-checked", "true");
  });

  it("labels back-three wing-backs on the pitch, filled from the full-back rows", () => {
    window.history.replaceState(null, "", "/build/demo-lol?sport=soccer");
    render(<App />);
    fireEvent.change(screen.getByRole("combobox", { name: "Squad" }), {
      target: { value: "soccer-352" },
    });
    const rwb = screen.getByTestId("field-squad").querySelector('[data-slot="rwb"]')!;
    expect(rwb).toHaveAttribute("data-ref", "RB1");
    expect(rwb.textContent).toContain("RWB");
  });

  it("lets one player take several set pieces", () => {
    window.history.replaceState(null, "", "/build/demo-lol?sport=soccer");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "+ Set pieces" }));
    const card = within(screen.getByTestId("pool")).getByRole("button", { name: /^Ahri/ });
    const tile = (spot: string) =>
      screen.getByTestId("set-pieces").querySelector(`[data-spot="${spot}"]`) as HTMLElement;
    fireEvent.click(card);
    fireEvent.click(tile("CAPT"));
    fireEvent.click(card);
    fireEvent.click(tile("PEN"));
    expect(tile("CAPT")).toHaveAccessibleName("Ahri, set pieces CAPT");
    expect(tile("PEN")).toHaveAccessibleName("Ahri, set pieces PEN");
  });
});

describe("basketball (#63)", () => {
  beforeEach(() => window.history.replaceState(null, "", "/build/demo-lol?sport=basketball"));

  it("puts the starting five on the court, three deep in the depth chart", () => {
    render(<App />);
    const court = screen.getByTestId("field-roster");
    const refs = [...court.querySelectorAll(".slot")].map((s) => (s as HTMLElement).dataset.ref);
    expect(refs.sort()).toEqual(["C1", "PF1", "PG1", "SF1", "SG1"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Roster" }), {
      target: { value: "basketball-second" },
    });
    expect(screen.getByTestId("field-roster").querySelector('[data-slot="pg"]')).toHaveAttribute(
      "data-ref",
      "PG2",
    );
    fireEvent.click(screen.getByRole("button", { name: "Depth chart" }));
    expect(screen.getByTestId("depth-roster").querySelectorAll("[data-spot]")).toHaveLength(15);
  });

  it("closing five takes anyone from the roster, once each", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "+ Closing five" }));
    const card = within(screen.getByTestId("pool")).getByRole("button", { name: /^Ahri/ });
    const tile = (spot: string) =>
      screen.getByTestId("closing").querySelector(`[data-spot="${spot}"]`) as HTMLElement;
    fireEvent.click(card);
    fireEvent.click(tile("CL1"));
    fireEvent.click(card);
    fireEvent.click(tile("CL3"));
    expect(tile("CL1")).toHaveAccessibleName("Empty closing five CL1");
    expect(tile("CL3")).toHaveAccessibleName("Ahri, closing five CL3");
  });
});

describe("baseball (#65)", () => {
  beforeEach(() => window.history.replaceState(null, "", "/build/demo-lol?sport=baseball"));
  const order = () =>
    [...screen.getByTestId("batting-order").querySelectorAll("li")].map(
      (li) => (li as HTMLElement).dataset.order,
    );

  it("puts the day's starter on the mound and nine on the diamond", () => {
    render(<App />);
    const diamond = screen.getByTestId("field-hitters");
    expect(diamond.querySelectorAll(".slot")).toHaveLength(9);
    expect(diamond.querySelector('[data-slot="p"]')).toHaveAttribute("data-ref", "SP1");
    expect(screen.queryByRole("combobox", { name: "Pitchers" })).toBeNull();
  });

  it("reorders the batting order and swaps the DH for the pitcher", () => {
    render(<App />);
    expect(order()).toEqual(["CF", "SS", "1B", "DH", "3B", "RF", "LF", "2B", "C"]);
    fireEvent.click(screen.getByRole("button", { name: "Move C up the order" }));
    expect(order().slice(-2)).toEqual(["C", "2B"]);
    fireEvent.change(screen.getByRole("combobox", { name: "DH" }), { target: { value: "no-dh" } });
    expect(order()[3]).toBe("P");
    fireEvent.click(screen.getByRole("button", { name: "Depth chart" }));
    expect(
      within(screen.getByTestId("depth-hitters"))
        .getAllByRole("rowheader")
        .map((th) => th.textContent),
    ).not.toContain("DH");
  });
});
