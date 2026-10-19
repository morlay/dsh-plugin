// 浏览器/API 连接面契约：令牌按服务语义命名（上游注册名 `connection`）。
import type { IncomingMessage, ServerResponse } from "node:http";
import { Injectable } from "@morlay/zephyr";

interface ConnectionFace {
  readonly requestRejection: (req: IncomingMessage) => number | undefined;
  readonly authorizeIndex: (req: IncomingMessage, res: ServerResponse) => boolean;
  readonly authenticatedUrl: (baseUrl: string) => string;
  readonly admitConnection: (req: IncomingMessage) => unknown;
}

@Injectable()
export abstract class Connection implements ConnectionFace {
  abstract readonly requestRejection: ConnectionFace["requestRejection"];

  abstract readonly authorizeIndex: ConnectionFace["authorizeIndex"];

  abstract readonly authenticatedUrl: ConnectionFace["authenticatedUrl"];

  abstract readonly admitConnection: ConnectionFace["admitConnection"];
}
