import { Module } from "@nestjs/common";
import { ResilienceModule } from "@ftr/resilience";
import { DatabaseModule, pool } from "./database";
import { StudentsController } from "./students.controller";
import { StudentsService } from "./students.service";

@Module({
  imports: [DatabaseModule, ResilienceModule.forRoot({ serviceName: "student-service", readinessCheck: () => pool.query("SELECT 1") })],
  controllers: [StudentsController],
  providers: [StudentsService],
})
export class AppModule {}
