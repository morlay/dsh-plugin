// 联邦产物契约：按 URL 命中「已产出 / 按需产出」的 client 产物。
import type { IncomingMessage, ServerResponse } from "node:http";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class Federation {
  /** 处理 `/_zephyr/@modules/...` 请求；返回 true 表示已应答（不再往下传）。 */
  abstract serve(url: string, req: IncomingMessage, res: ServerResponse): Promise<boolean>;

  /** 裸说明符 → 联邦地址（vite 的 `resolveId` 用；三方与聚合包都走这条链）。 */
  abstract depsUrl(specifier: string, importer?: string): Promise<string | undefined>;
}
