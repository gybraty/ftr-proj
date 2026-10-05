import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { FlagsClient, withTimeout } from "@ftr/resilience";
import { Db } from "./database";

/** last successful read per key ("all", "course:<id>"); module-level so the cache-reset hook can reach it */
export const lastGood = new Map<string, { data: unknown; at: Date }>();

export interface Result { data: any; degradedAt?: Date }

@Injectable()
export class TimetableService {
  private readonly log = new Logger(TimetableService.name);
  constructor(private db: Db, private flags: FlagsClient) {}

  private async read(key: string, sql: string, params: unknown[] = []): Promise<Result> {
    try {
      const data = await withTimeout(() => this.db.query(sql, params), 2000, this.flags.isOn("timeout"));
      lastGood.set(key, { data, at: new Date() });
      return { data };
    } catch (e) {
      this.log.warn(`db read failed (${key}): ${(e as Error).message}`);
      const hit = lastGood.get(key);
      if (hit && this.flags.isOn("gracefulDegradation")) return { data: hit.data, degradedAt: hit.at };
      throw new ServiceUnavailableException();
    }
  }

  all() { return this.read("all", "SELECT id, course_id, slot, room FROM timetable.timetables ORDER BY course_id, id"); }

  forCourse(id: number) {
    return this.read(`course:${id}`, "SELECT id, course_id, slot, room FROM timetable.timetables WHERE course_id=$1 ORDER BY id", [id]);
  }

  resetCache() { lastGood.clear(); }
}
