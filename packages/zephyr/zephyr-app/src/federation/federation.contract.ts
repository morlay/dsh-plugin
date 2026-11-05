// 联邦产物契约：按 URL 命中「已产出 / 按需产出」的 client 产物。
import type { IncomingMessage, ServerResponse } from "node:http";
import { Injectable } from "@morlay/zephyr";

/** 预构建的范围（**只影响"哪些包当文件走 vite"，不影响功能**）。 */
export interface FederationConfig {
  readonly dev: {
    /** 当文件的包名（glob）。**空数组 = 全部预构建**。 */
    readonly include: readonly string[];
  };
}

@Injectable()
export abstract class Federation {
  /** 处理 `/_zephyr/@modules/...` 请求；返回 true 表示已应答（不再往下传）。 */
  abstract serve(url: string, req: IncomingMessage, res: ServerResponse): Promise<boolean>;

  /** 裸说明符 → 联邦地址（vite 的 `resolveId` 用；三方与聚合包都走这条链）。 */
  abstract depsUrl(specifier: string, importer?: string): Promise<string | undefined>;

  /** 预构建的开关与范围（装配面经 `configure(FederationDefault, { dev, devFiles })` 给）。 */
  abstract readonly config: FederationConfig;
}
