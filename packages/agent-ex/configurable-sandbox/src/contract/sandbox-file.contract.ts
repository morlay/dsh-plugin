// 配置文件的读面：把"从哪读、怎么读"变成可注入的依赖。
//
// 默认实现读 `{DSH_HOME}/sandbox.toml`；测试注入假件，不碰真实 `$DSH_HOME`。
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class SandboxFile {
  // 配置文件内容；文件不存在给 `undefined`（与"读到空"区分开：前者是"没写规则"）。
  abstract read(): Promise<string | undefined>;

  // 配置文件路径（日志里点名用）。
  abstract readonly path: string;
}
