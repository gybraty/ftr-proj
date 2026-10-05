import { ALL_FLAGS, FlagsClient } from "./flags-client";

describe("FlagsClient", () => {
  it("all flags on by default", () => {
    const c = new FlagsClient(true);
    for (const f of ALL_FLAGS) expect(c.isOn(f)).toBe(true);
  });

  it("all flags off when FT mode is off", () => {
    const c = new FlagsClient(false);
    for (const f of ALL_FLAGS) expect(c.isOn(f)).toBe(false);
    expect(c.snapshot().retry).toBe(false);
  });

  it("reads FT_MODE from env", () => {
    process.env.FT_MODE = "off";
    expect(new FlagsClient().isOn("retry")).toBe(false);
    process.env.FT_MODE = "on";
    expect(new FlagsClient().isOn("retry")).toBe(true);
    delete process.env.FT_MODE;
  });
});
