import { Module } from "@nestjs/common";
import { ResilienceModule } from "@ftr/resilience";
import { DatabaseModule, pool } from "./database";
import { TimetableController } from "./timetable.controller";
import { TimetableService, lastGood } from "./timetable.service";

@Module({
  imports: [DatabaseModule, ResilienceModule.forRoot({
    serviceName: "timetable-service",
    readinessCheck: () => pool.query("SELECT 1"),
    cacheResetHook: () => lastGood.clear(),
  })],
  controllers: [TimetableController],
  providers: [TimetableService],
})
export class AppModule {}
