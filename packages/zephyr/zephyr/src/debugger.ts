// 装配诊断：普通契约 + 默认实现，不挂在 App 上（一切皆插件）。
import { Injectable } from "./token.ts";

/** 装配快照。 */
export interface DebugSnapshot {
  /** 每一行的启动结果。 */
  readonly rows: readonly { name: string; state: "started" | "failed"; reason?: string }[];
  /** cordis store 里的服务名。 */
  readonly names: readonly string[];
  /** 可注入的令牌名。 */
  readonly tokens: readonly string[];
}

/** 诊断契约。 */
@Injectable()
export abstract class Debugger {
  /** @returns 当前装配快照。 */
  abstract diagnostics(): DebugSnapshot;
}

/** 默认实现：读 bootstrap 维护的那份快照。 */
@Injectable()
export class DebuggerDefault extends Debugger {
  /**
   * @param snapshotOf - 取当前快照（装配完成后即为最终结果）。
   */
  constructor(private readonly snapshotOf: () => DebugSnapshot) {
    super();
  }

  diagnostics(): DebugSnapshot {
    return this.snapshotOf();
  }
}
