import { RecordsService } from "./records.service";

describe("RecordsService", () => {
  const db = { query: jest.fn() };
  const flags = { isOn: jest.fn().mockReturnValue(true) };
  const svc = new RecordsService(db as any, flags as any);
  beforeEach(() => { jest.resetAllMocks(); flags.isOn.mockReturnValue(true); });

  it("eligible when no grade", async () => {
    db.query.mockResolvedValue([]);
    await expect(svc.eligibility(1, 9)).resolves.toEqual({ eligible: true });
  });

  it("not eligible when grade exists", async () => {
    db.query.mockResolvedValue([{ id: 1 }]);
    await expect(svc.eligibility(1, 1)).resolves.toEqual({ eligible: false });
  });

  it("computes gpa to two decimals", async () => {
    db.query.mockResolvedValue([{ course_id: 1, grade: "A" }, { course_id: 2, grade: "B" }, { course_id: 3, grade: "D" }]);
    await expect(svc.transcript(1)).resolves.toEqual({
      studentId: 1,
      entries: [{ courseId: 1, grade: "A" }, { courseId: 2, grade: "B" }, { courseId: 3, grade: "D" }],
      gpa: 2.67,
    });
  });

  it("gpa 0 for empty transcript", async () => {
    db.query.mockResolvedValue([]);
    expect((await svc.transcript(1)).gpa).toBe(0);
  });

  it("degrades to queued when db fails and flag on", async () => {
    db.query.mockRejectedValue(new Error("down"));
    await expect(svc.transcriptOrQueued(1)).resolves.toEqual({ status: "queued" });
  });

  it("rethrows when db fails and flag off", async () => {
    flags.isOn.mockImplementation((f: string) => f !== "gracefulDegradation");
    db.query.mockRejectedValue(new Error("down"));
    await expect(svc.transcriptOrQueued(1)).rejects.toThrow("down");
  });
});
