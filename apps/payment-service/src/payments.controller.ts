import { BadRequestException, Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ChaosService, ChaosTokenGuard } from "@ftr/resilience";
import { PaymentsService } from "./payments.service";

@Controller()
export class PaymentsController {
  constructor(private svc: PaymentsService, private chaos: ChaosService) {}

  @Post("payments")
  async create(
    @Body() b: { studentId: number; amount: number },
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: { status(code: number): unknown },
  ) {
    const { payment, existing } = await this.svc.create({ studentId: Number(b.studentId), amount: Number(b.amount), idempotencyKey: key });
    res.status(existing ? 200 : 201);
    return payment;
  }

  @Get("payments")
  list(@Query("studentId") studentId?: string) {
    if (!studentId || !Number.isInteger(Number(studentId))) throw new BadRequestException("studentId required");
    return this.svc.list(Number(studentId));
  }

  @Get("payments/:id")
  async get(@Param("id", ParseIntPipe) id: number) {
    const p = await this.svc.get(id);
    if (!p) throw new NotFoundException();
    return p;
  }

  @Post("chaos/fail-midway") @HttpCode(200) @UseGuards(ChaosTokenGuard)
  failMidway() {
    this.chaos.custom.set("failMidway", true);
    return { failMidway: true };
  }
}
