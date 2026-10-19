// client 行清单契约：装配方给值（从入口 Module 推导），`ClientModulesModule` 消费。
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class ClientRows {
  /** 行包名（外置名单/缓存键用）。 */
  abstract readonly rows: readonly string[];

  /** 包名 → client 半的源文件（vite 的虚拟模块用；缺省表示由 vite 自行解析）。 */
  abstract readonly clientPaths: ReadonlyMap<string, string>;
}
