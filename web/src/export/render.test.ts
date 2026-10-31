import { describe, expect, it } from "vitest";
import { exportFilename } from "./render";

describe("exportFilename", () => {
  it("slugifies the title and names the layout", () => {
    expect(exportFilename("My Team", "depth")).toBe("my-team-depth-chart.png");
    expect(exportFilename("Bïg  Plays!! 2026", "field")).toBe("big-plays-2026-field.png");
    expect(exportFilename("   ", "offense")).toBe("team-offense.png");
  });
});
