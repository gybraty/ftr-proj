import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { ChaosService, FlagsClient, ResilientHttp, withTimeout } from "@ftr/resilience";
import { Db as PgDb } from "./database";
import { recoverIncomplete } from "./recovery";
import { runPaymentSaga } from "./saga";

@Injectable()
export class PaymentsService implements OnApplicationBootstrap {
  constructor(private pg: PgDb, private http: ResilientHttp, private flags: FlagsClient, private chaos: ChaosService) {}

  /** db wrapper: every query bounded by the timeout flag */
  private db = { query: (sql: string, params: unknown[] = []) => withTimeout(() => this.pg.query(sql, params), 2000, this.flags.isOn("timeout")) };

  onApplicationBootstrap() {
    const tick = () => recoverIncomplete(this.db, this.http, this.flags).catch((e) => console.error("[recovery]", e));
    void tick();
    setInterval(tick, 10_000).unref();
  }

  create(input: { studentId: number; amount: number; idempotencyKey?: string }) {
    return runPaymentSaga({ db: this.db, http: this.http, flags: this.flags, chaos: this.chaos }, input);
  }

  async get(id: number) {
    return (await this.db.query("SELECT * FROM payment.payments WHERE id=$1", [id]))[0];
  }
  list(studentId: number) {
    return this.db.query("SELECT * FROM payment.payments WHERE student_id=$1 ORDER BY id DESC LIMIT 50", [studentId]);
  }

}
