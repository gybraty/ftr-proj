import { Module } from "@nestjs/common";
import { ResilienceModule } from "@ftr/resilience";
import { ProxyController } from "./proxy.controller";
import { ProxyService } from "./proxy.service";

@Module({
  imports: [ResilienceModule.forRoot({ serviceName: "gateway" })],
  controllers: [ProxyController],
  providers: [ProxyService],
})
export class AppModule {}
