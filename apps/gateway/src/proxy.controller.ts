import { All, Controller, Get, Req, Res } from "@nestjs/common";
import { ProxyService } from "./proxy.service";

@Controller()
export class ProxyController {
  constructor(private proxy: ProxyService) {}

  @Get("gateway/breakers")
  breakers() { return this.proxy.breakers(); }

  @All("api/*")
  async handle(@Req() req: any, @Res() res: any) {
    const r = await this.proxy.forward(req.method, req.originalUrl, req.body, req.headers);
    res.status(r.status).set(r.headers).json(r.body);
  }
}
