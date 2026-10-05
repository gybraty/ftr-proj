import { runPaymentSaga } from "./saga";
import { fakeDb } from "./fake-db";

const mk = (on = true, db = fakeDb()) => ({
  db, http: { post: jest.fn().mockResolvedValue({ status: 200 }) } as any,
  flags: { isOn: jest.fn().mockReturnValue(on) } as any, chaos: { custom: new Map() } as any,
});
const input = { studentId: 1, amount: 500, idempotencyKey: "k1" };

describe("payment saga", () => {
  it("happy path persists steps in order and completes", async () => {
    const d = mk();
    const r = await runPaymentSaga(d, input);
    expect(d.db.steps.map((s) => s.step)).toEqual(["validate", "debit", "record", "complete"]);
    expect(d.db.payments[0].status).toBe("completed");
    expect(r).toMatchObject({ existing: false, payment: { status: "completed" } });
  });

  it("idempotency ON returns existing payment for repeated key", async () => {
    const d = mk();
    const a = await runPaymentSaga(d, input);
    const b = await runPaymentSaga(d, input);
    expect(b.existing).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    expect(d.db.payments).toHaveLength(1);
  });

  it("idempotency OFF inserts duplicate rows for same key", async () => {
    const d = mk(false);
    await runPaymentSaga(d, input);
    await runPaymentSaga(d, input);
    expect(d.db.payments).toHaveLength(2);
  });

  it("concurrent duplicate: unique violation returns existing payment", async () => {
    const d = mk();
    d.db.payments.push({ id: 7, idempotency_key: "k1", status: "pending" });
    const db2 = fakeDb({ insertError: { code: "23505" } });
    db2.payments.push({ id: 7, idempotency_key: "k1", status: "pending" });
    // first lookup must miss: stub it to miss once
    const q = db2.query.getMockImplementation()!;
    db2.query.mockImplementationOnce(async () => []).mockImplementation(q);
    const r = await runPaymentSaga({ ...d, db: db2 }, input);
    expect(r).toMatchObject({ existing: true, payment: { id: 7 } });
  });

  it("failMidway exits after debit before record", async () => {
    const d = mk();
    d.chaos.custom.set("failMidway", true);
    const exit = jest.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as any);
    await expect(runPaymentSaga(d, input)).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(d.db.steps.map((s) => s.step)).toEqual(["validate", "debit"]);
    expect(d.db.payments[0].status).toBe("debited");
    expect(d.http.post).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});
