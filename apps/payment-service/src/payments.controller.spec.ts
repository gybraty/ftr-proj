import { PaymentsController } from "./payments.controller";

describe("PaymentsController.list", () => {
  const list = jest.fn(async () => [{ id: 1 }]);
  const c = new PaymentsController({ list } as any, {} as any);
  it("lists by studentId", async () => {
    expect(await c.list("7")).toEqual([{ id: 1 }]);
    expect(list).toHaveBeenCalledWith(7);
  });
  it("missing studentId -> 400", () => {
    expect(() => c.list(undefined)).toThrow();
  });
});
