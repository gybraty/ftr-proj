import { recoverIncomplete } from "./recovery";
import { inflight } from "./saga";
import { fakeDb } from "./fake-db";

const mk = (checkpointing: boolean) => ({
  db: fakeDb(), http: { post: jest.fn().mockResolvedValue({}) } as any,
  flags: { isOn: (f: string) => (f === "checkpointing" ? checkpointing : true) } as any,
});

describe("recovery", () => {
  beforeAll(() => { jest.spyOn(console, "log").mockImplementation(() => {}); });
  it("checkpointing ON resumes debited payment to completed", async () => {
    const { db, http, flags } = mk(true);
    db.payments.push({ id: 1, student_id: 3, status: "debited" });
    await recoverIncomplete(db, http, flags);
    expect(db.payments[0].status).toBe("completed");
    expect(db.steps.map((s) => s.step)).toEqual(["record", "complete"]);
    expect(http.post).toHaveBeenCalledWith("records", expect.stringContaining("/internal/tuition"), { studentId: 3, paymentId: 1 });
  });

  it("recorded payment with record step already persisted does not duplicate it", async () => {
    const { db, http, flags } = mk(true);
    db.payments.push({ id: 1, student_id: 3, status: "recorded" });
    db.steps.push({ payment_id: 1, step: "record" });
    await recoverIncomplete(db, http, flags);
    expect(db.steps.map((s) => s.step)).toEqual(["record", "complete"]);
  });

  it("checkpointing ON rolls back pending payment", async () => {
    const { db, http, flags } = mk(true);
    db.payments.push({ id: 1, student_id: 3, status: "pending" });
    await recoverIncomplete(db, http, flags);
    expect(db.payments[0].status).toBe("rolled_back");
    expect(db.steps.map((s) => s.step)).toEqual(["rollback"]);
    expect(http.post).not.toHaveBeenCalled();
  });

  it("checkpointing OFF leaves debited payment untouched", async () => {
    const { db, http, flags } = mk(false);
    db.payments.push({ id: 1, student_id: 3, status: "debited" });
    await recoverIncomplete(db, http, flags);
    expect(db.payments[0].status).toBe("debited");
    expect(http.post).not.toHaveBeenCalled();
  });

  it("skips payments the saga is currently running", async () => {
    const { db, http, flags } = mk(true);
    db.payments.push({ id: 1, student_id: 3, status: "debited" });
    inflight.add(1);
    await recoverIncomplete(db, http, flags);
    inflight.delete(1);
    expect(db.payments[0].status).toBe("debited");
  });

  it("ignores non-terminal payment with fresh updated_at", async () => {
    const { db, http, flags } = mk(true);
    db.payments.push({ id: 1, student_id: 3, status: "pending", updated_at: Date.now() });
    await recoverIncomplete(db, http, flags);
    expect(db.payments[0].status).toBe("pending");
    expect(db.steps).toEqual([]);
  });

  it("rollback CAS: status already changed -> no rollback step", async () => {
    const { db, http, flags } = mk(true);
    db.payments.push({ id: 1, student_id: 3, status: "pending" });
    const q = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql: string, p?: any[]) => {
      const rows = await q(sql, p);
      if (sql.includes("status IN")) db.payments[0].status = "debited"; // another pod advanced it after our SELECT
      return rows;
    });
    await recoverIncomplete(db, http, flags);
    expect(db.steps).toEqual([]);
    expect(db.payments[0].status).toBe("debited");
  });
});
