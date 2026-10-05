import { Controller, Get, Param, ParseIntPipe, Res } from "@nestjs/common";
import { Result, TimetableService } from "./timetable.service";

type Res_ = { setHeader(k: string, v: string): unknown };
const send = (r: Result, res: Res_) => {
  if (r.degradedAt) { res.setHeader("X-Degraded", "true"); res.setHeader("X-Degraded-At", r.degradedAt.toISOString()); }
  return r.data;
};

@Controller("timetables")
export class TimetableController {
  constructor(private svc: TimetableService) {}

  @Get() async all(@Res({ passthrough: true }) res: Res_) { return send(await this.svc.all(), res); }

  @Get(":courseId")
  async forCourse(@Param("courseId", ParseIntPipe) id: number, @Res({ passthrough: true }) res: Res_) {
    return send(await this.svc.forCourse(id), res);
  }
}
