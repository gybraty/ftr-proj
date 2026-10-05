import { Module } from "@nestjs/common";
import { ResilienceModule } from "@ftr/resilience";
import { DatabaseModule, pool } from "./database";
import { RecordsController } from "./records.controller";
import { RecordsService } from "./records.service";

@Module({
  imports: [DatabaseModule, ResilienceModule.forRoot({ serviceName: "records-service", readinessCheck: () => pool.query("SELECT 1") })],
  controllers: [RecordsController],
  providers: [RecordsService],
})
export class AppModule {}
