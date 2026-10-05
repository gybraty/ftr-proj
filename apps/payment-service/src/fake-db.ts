/** In-memory stand-in for the payment tables, keyed off SQL text. Test helper only. */
export function fakeDb(opts: { insertError?: any } = {}) {
  const payments: any[] = [];
  const steps: { payment_id: number; step: string }[] = [];
  const db = {
    payments, steps,
    query: jest.fn(async (sql: string, p: any[] = []) => {
      if (sql.includes("SELECT * FROM payment.payments WHERE idempotency_key")) return payments.filter((x) => x.idempotency_key === p[0]);
      if (sql.includes("INSERT INTO payment.payments")) {
        if (opts.insertError) throw opts.insertError;
        const row = { id: payments.length + 1, student_id: p[0], amount: p[1], status: "pending", idempotency_key: p[2] };
        payments.push(row);
        return [row];
      }
      if (sql.includes("INSERT INTO payment.payment_steps")) { steps.push({ payment_id: p[0], step: p[1] }); return []; }
      if (sql.includes("AND status=$2")) {
        const row = payments.find((x) => x.id === p[0] && x.status === p[1]);
        if (!row) return [];
        row.status = p[2];
        return [{ id: row.id }];
      }
      if (sql.includes("UPDATE payment.payments SET status")) { payments.find((x) => x.id === p[0]).status = p[1]; return []; }
      if (sql.includes("FROM payment.payment_steps")) return steps.filter((s) => s.payment_id === p[0] && s.step === "record");
      if (sql.includes("status IN")) return payments.filter((x) => ["pending", "debited", "recorded"].includes(x.status) && !(x.updated_at && Date.now() - x.updated_at < 5000)).map((x) => ({ ...x })); // copies, like a real SELECT
      throw new Error("unexpected sql " + sql);
    }),
  };
  return db;
}
