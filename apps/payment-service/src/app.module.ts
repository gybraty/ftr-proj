import { Module } from "@nestjs/common";
import { ResilienceModule } from "@ftr/resilience";
import { DatabaseModule, pool } from "./database";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [DatabaseModule, ResilienceModule.forRoot({ serviceName: "payment-service", readinessCheck: () => pool.query("SELECT 1") })],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class AppModule {}
