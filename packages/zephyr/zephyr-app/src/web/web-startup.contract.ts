// web 启动值契约（host/port/trustedHosts）：装配方给值，消费方注入。
import { Injectable } from "@morlay/zephyr";

export interface WebStartupValues {
  readonly host?: string;
  readonly port?: number;
  readonly tls?: unknown;
  readonly publicUrl?: string;
  readonly trustedHosts?: string[];
}

@Injectable()
export abstract class WebStartup {
  abstract readonly values: WebStartupValues;
}
