import { Injectable } from "@nestjs/common";
import { FlagsClient, withTimeout } from "@ftr/resilience";
import { Db } from "./database";

const POINTS: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

@Injectable()
export class RecordsService {
  constructor(private db: Db, private flags: FlagsClient) {}

  private q(sql: string, params: unknown[] = []) {
    return withTimeout(() => this.db.query(sql, params), 2000, this.flags.isOn("timeout"));
  }

  async eligibility(studentId: number, courseId: number) {
    const rows = await this.q("SELECT id FROM records.grades WHERE student_id=$1 AND course_id=$2 LIMIT 1", [studentId, courseId]);
    return { eligible: rows.length === 0 };
  }

  async transcript(studentId: number) {
    const rows = await this.q("SELECT course_id, grade FROM records.grades WHERE student_id=$1 ORDER BY course_id", [studentId]);
    const entries = rows.map((r) => ({ courseId: r.course_id, grade: r.grade }));
    const sum = entries.reduce((s, e) => s + (POINTS[e.grade] ?? 0), 0);
    return { studentId, entries, gpa: entries.length ? Math.round((sum / entries.length) * 100) / 100 : 0 };
  }

  /** DB failure: gracefulDegradation ON -> {status:"queued"}, OFF -> rethrow */
  async transcriptOrQueued(studentId: number) {
    try {
      return await this.transcript(studentId);
    } catch (e) {
      if (this.flags.isOn("gracefulDegradation")) return { status: "queued" as const };
      throw e;
    }
  }

  async markPaid(studentId: number, paymentId: number) {
    await this.q(
      `INSERT INTO records.tuition_status(student_id, paid, payment_id) VALUES($1,true,$2)
       ON CONFLICT (student_id, term) DO UPDATE SET paid=true, payment_id=$2`, [studentId, paymentId]);
    return { ok: true };
  }

  async rollback(paymentId: number) {
    await this.q("UPDATE records.tuition_status SET paid=false WHERE payment_id=$1", [paymentId]);
    return { ok: true };
  }
}
