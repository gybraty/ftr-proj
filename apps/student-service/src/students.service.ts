import { BadGatewayException, ConflictException, Injectable } from "@nestjs/common";
import { FlagsClient, ResilientHttp, withTimeout } from "@ftr/resilience";
import { Db } from "./database";

@Injectable()
export class StudentsService {
  private recordsUrl = process.env.RECORDS_URL ?? "http://records-service:3003";
  constructor(private db: Db, private http: ResilientHttp, private flags: FlagsClient) {}

  private q(sql: string, params: unknown[] = []) {
    return withTimeout(() => this.db.query(sql, params), 2000, this.flags.isOn("timeout"));
  }

  async create(name: string, email: string) {
    try {
      return (await this.q("INSERT INTO student.students(name,email) VALUES($1,$2) RETURNING id,name,email", [name, email]))[0];
    } catch (e: any) {
      if (e?.code === "23505") throw new ConflictException("email already exists");
      throw e;
    }
  }

  list() { return this.q("SELECT id,name,email FROM student.students ORDER BY id"); }

  async enroll(studentId: number, courseId: number) {
    const dup = await this.q("SELECT id FROM student.enrollments WHERE student_id=$1 AND course_id=$2 AND status='active'", [studentId, courseId]);
    if (dup.length) throw new ConflictException("already enrolled");

    let eligible: boolean;
    try {
      ({ eligible } = await this.http.get<{ eligible: boolean }>("records", `${this.recordsUrl}/eligibility/${studentId}/${courseId}`));
    } catch {
      throw new BadGatewayException({ error: "records-unavailable" });
    }
    if (!eligible) throw new ConflictException("not eligible");

    try {
      return (await this.q("INSERT INTO student.enrollments(student_id,course_id) VALUES($1,$2) RETURNING id,student_id,course_id,status", [studentId, courseId]))[0];
    } catch (e: any) {
      if (e?.code === "23505") throw new ConflictException("already enrolled");
      throw e;
    }
  }
}
