import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { MetricsInterceptor } from "@ftr/resilience";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalInterceptors(app.get(MetricsInterceptor));
  await app.listen(Number(process.env.PORT ?? 3003), "0.0.0.0");
}
bootstrap();
