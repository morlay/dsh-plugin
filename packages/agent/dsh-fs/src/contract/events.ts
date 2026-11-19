// fs 域的事件：三条**意图瀑布**（上游 `fs/write-intent` / `fs/edit-intent` / `fs/delete-intent`）。
//
// 上游用 `ctx.waterfall('fs/write-intent', target, actor, next)` 派发；我们在这里用同一套名字订阅。
// `target` 是 `FsTarget`（本包契约面已导出），`actor` 是上游原话的「opaque tool-execution context」——
// 它本来就不是域类型，别为它造一个更具体的形状。
import type { FsTarget, FsVersion, FsWriteIntent } from "./fs-io.contract.ts";
import { EventEmitter, type Next } from "@morlay/zephyr";

/** 上游的 actor 槽：不透明的工具执行上下文（上游就是 `object | undefined`）。 */
type FsIntentActor = object | undefined;

/** 写入前的意图检查（CAS 安全网）：`(target, actor, next)`，返回写意图或 `undefined`。 */
export class FsWriteIntentEvent extends EventEmitter<
  [FsTarget, FsIntentActor, Next<FsWriteIntent | undefined>],
  Promise<FsWriteIntent | undefined>
> {
  constructor() {
    super("fs/write-intent");
  }
}

/** 编辑前的意图检查（先读后改）：返回本次读写用的版本或 `undefined`。 */
export class FsEditIntentEvent extends EventEmitter<
  [FsTarget, FsIntentActor, Next<{ readonly version: FsVersion } | undefined>],
  Promise<{ readonly version: FsVersion } | undefined>
> {
  constructor() {
    super("fs/edit-intent");
  }
}

/** 删除前的意图检查。 */
export class FsDeleteIntentEvent extends EventEmitter<
  [FsTarget, FsIntentActor, Next<{ readonly version: FsVersion } | undefined>],
  Promise<{ readonly version: FsVersion } | undefined>
> {
  constructor() {
    super("fs/delete-intent");
  }
}
