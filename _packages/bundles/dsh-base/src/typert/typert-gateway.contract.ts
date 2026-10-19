// API gateway 契约：令牌按服务语义命名（上游注册名 `typertGateway`）。
import type TypertGatewayService from "@deepseek-ai/dsh-api-gateway";
import { Injectable } from "@morlay/zephyr";

interface TypertGatewayFace {
  readonly wireStream: TypertGatewayService["wireStream"];
}

@Injectable()
export abstract class TypertGateway implements TypertGatewayFace {
  abstract readonly wireStream: TypertGatewayFace["wireStream"];
}
