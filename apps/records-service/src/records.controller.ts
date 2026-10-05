import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Res, ServiceUnavailableException } from "@nestjs/common";
import { RecordsService } from "./records.service";

@Controller()
export class RecordsController {
  constructor(private svc: RecordsService) {}

  @Get("eligibility/:studentId/:courseId")
  eligibility(@Param("studentId", ParseIntPipe) s: number, @Param("courseId", ParseIntPipe) c: number) { return this.svc.eligibility(s, c); }

  @Get("transcripts/:studentId")
  async transcript(@Param("studentId", ParseIntPipe) s: number, @Res({ passthrough: true }) res: { status(code: number): unknown }) {
    let r;
    try { r = await this.svc.transcriptOrQueued(s); } catch { throw new ServiceUnavailableException(); } // degradation OFF
    if ("status" in r) res.status(202);
    return r;
  }

  @Post("internal/tuition") @HttpCode(200)
  tuition(@Body() b: { studentId: number; paymentId: number }) { return this.svc.markPaid(Number(b.studentId), Number(b.paymentId)); }

  @Post("internal/tuition/rollback") @HttpCode(200)
  rollback(@Body() b: { paymentId: number }) { return this.svc.rollback(Number(b.paymentId)); }
}
