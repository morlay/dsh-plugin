// 装配面契约：把「联邦路由 + 页面兜底 + remote 装载」接到宿主上。
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class ClientModules {
  /** 注册路由与远端；返回卸载函数（逆序撤销）。 */
  abstract install(): Promise<() => Promise<void>>;
}
