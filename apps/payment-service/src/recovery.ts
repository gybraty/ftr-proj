import type { FlagsClient, ResilientHttp } from "@ftr/resilience";
import { Db, casStatus, inflight, recordsUrl, step } from "./saga";

export async function recoverIncomplete(db: Db, http: ResilientHttp, flags: FlagsClient): Promise<void> {
  if (!flags.isOn("checkpointing")) return;
  // 30s > worst-case saga step (records call with retries ~9.4s)
  const rows = await db.query(`SELECT * FROM payment.payments WHERE status IN ('pending','debited','recorded') AND updated_at < now() - interval '30 seconds' ORDER BY id`);
  for (const p of rows) {
    if (inflight.has(p.id)) continue;
    try {
      if (p.status === "pending") {
        if (!(await casStatus(db, p.id, "pending", "rolled_back"))) continue; // someone else moved it
        await step(db, p.id, "rollback");
        console.log(`[recovery] payment ${p.id} rolled back`);
        continue;
      }
      await http.post("records", `${recordsUrl()}/internal/tuition`, { studentId: p.student_id, paymentId: p.id }); // idempotent upsert
      if (!(await casStatus(db, p.id, p.status, "recorded"))) continue;
      const done = await db.query(`SELECT 1 FROM payment.payment_steps WHERE payment_id=$1 AND step='record'`, [p.id]);
      if (!done.length) await step(db, p.id, "record");
      if (!(await casStatus(db, p.id, "recorded", "completed"))) continue;
      await step(db, p.id, "complete");
      console.log(`[recovery] payment ${p.id} resumed -> completed`);
    } catch (e) {
      console.error(`[recovery] payment ${p.id} failed, will retry`, e); // next tick retries
    }
  }
}
