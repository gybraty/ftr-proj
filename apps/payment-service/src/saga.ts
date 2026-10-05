import type { ChaosService, FlagsClient, ResilientHttp } from "@ftr/resilience";

export interface Db { query(sql: string, params?: unknown[]): Promise<any[]>; }

/** payments this process is actively running; recovery must not race them */
export const inflight = new Set<number>();

export const recordsUrl = () => process.env.RECORDS_URL ?? "http://records-service:3003";

export const step = (db: Db, id: number, s: string) =>
  db.query(`INSERT INTO payment.payment_steps (payment_id, step) VALUES ($1,$2)`, [id, s]);

export const setStatus = (db: Db, id: number, status: string) =>
  db.query(`UPDATE payment.payments SET status=$2, updated_at=now() WHERE id=$1`, [id, status]);

/** compare-and-set transition; true only if this caller changed the row */
export const casStatus = async (db: Db, id: number, from: string, to: string) =>
  (await db.query(`UPDATE payment.payments SET status=$3, updated_at=now() WHERE id=$1 AND status=$2 RETURNING id`, [id, from, to])).length > 0;

export async function runPaymentSaga(
  deps: { db: Db; http: ResilientHttp; flags: FlagsClient; chaos: ChaosService },
  input: { studentId: number; amount: number; idempotencyKey?: string },
): Promise<{ payment: any; existing: boolean }> {
  const { db, http, flags, chaos } = deps;
  const key = flags.isOn("idempotency") ? input.idempotencyKey ?? null : null;

  if (key) {
    const [existing] = await db.query(`SELECT * FROM payment.payments WHERE idempotency_key = $1`, [key]);
    if (existing) return { payment: existing, existing: true };
  }

  let payment: any;
  try {
      [payment] = await db.query(
        `INSERT INTO payment.payments (student_id, amount, status, idempotency_key) VALUES ($1,$2,'pending',$3) RETURNING *`,
        [input.studentId, input.amount, key],
      );
    } catch (err: any) {
      if (err?.code === "23505" && key) {
        const [existing] = await db.query(`SELECT * FROM payment.payments WHERE idempotency_key = $1`, [key]);
        return { payment: existing, existing: true };
      }
      throw err;
    }
    inflight.add(payment.id);
    try {
    await step(db, payment.id, "validate");

    await new Promise((r) => setTimeout(r, 200)); // mock external debit
    await setStatus(db, payment.id, "debited");
    await step(db, payment.id, "debit");

    if (chaos.custom.get("failMidway")) process.exit(1);

    await http.post("records", `${recordsUrl()}/internal/tuition`, { studentId: payment.student_id, paymentId: payment.id });
    await setStatus(db, payment.id, "recorded");
    await step(db, payment.id, "record");

    await setStatus(db, payment.id, "completed");
    await step(db, payment.id, "complete");
    return { payment: { ...payment, status: "completed" }, existing: false };
  } finally { inflight.delete(payment.id); }
}
