import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { TimetableService, lastGood } from "./timetable.service";

describe("TimetableService", () => {
  const db = { query: jest.fn() };
  const flags = { isOn: jest.fn() };
  const svc = new TimetableService(db as any, flags as any);
  const rows = [{ id: 1, course_id: 1, slot: "Mon 9", room: "A1" }];
  beforeEach(() => { jest.resetAllMocks(); jest.spyOn(Logger.prototype, "warn").mockImplementation(); lastGood.clear(); flags.isOn.mockReturnValue(true); });

  it("fresh success populates cache", async () => {
    db.query.mockResolvedValue(rows);
    const r = await svc.forCourse(1);
    expect(r).toEqual({ data: rows });
    expect(lastGood.get("course:1")?.data).toEqual(rows);
    await svc.all();
    expect(lastGood.has("all")).toBe(true);
  });

  it("db down + flag on serves cache as degraded", async () => {
    db.query.mockResolvedValueOnce(rows);
    await svc.all();
    db.query.mockRejectedValue(new Error("down"));
    const r = await svc.all();
    expect(r.data).toEqual(rows);
    expect(r.degradedAt).toBe(lastGood.get("all")!.at);
  });

  it("db down + empty cache -> 503", async () => {
    db.query.mockRejectedValue(new Error("down"));
    await expect(svc.all()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("db down + flag off -> 503 even with cache", async () => {
    db.query.mockResolvedValueOnce(rows);
    await svc.all();
    flags.isOn.mockImplementation((f: string) => f !== "gracefulDegradation");
    db.query.mockRejectedValue(new Error("down"));
    await expect(svc.all()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("cache reset empties cache", async () => {
    db.query.mockResolvedValue(rows);
    await svc.all();
    svc.resetCache();
    expect(lastGood.size).toBe(0);
  });
});
