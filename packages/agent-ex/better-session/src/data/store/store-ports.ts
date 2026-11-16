// 数据面端口的唯一声明：handle 模型、日志入口、管理面都只认这一份（实现方是 admin/store.ts 的门面）。
import type { SessionPersistenceRevision } from "@morlay/dsh-session-persistence/contract";
import type { SessionRow } from "../backend.ts";
import type { Backend } from "../backend.ts";
import type { RdbBackendTracker } from "./handles.ts";
import type { RdbStoreHost } from "./host.ts";
import type { WriteGuard } from "../write-guard.ts";
import type { createReadPath } from "./read-path.ts";
import type { createWritePath } from "./write-path.ts";

export type ReadPath = ReturnType<typeof createReadPath>;

export type WritePath = ReturnType<typeof createWritePath>;

/** 数据面端口：后端、读写路径、句柄账本与日志屏障。 */
export interface StorePorts {
  /** 后端打开完成的屏障。 */
  ready(): Promise<void>;
  backend(): Backend;
  readPath(): ReadPath;
  writePath(): WritePath;
  host(): RdbStoreHost;
  readonly tracker: RdbBackendTracker;
  readonly writeGuard: WriteGuard;
  /** 真屏障：排干 live 写缓冲之后再等写句柄（上游 flush 的语义）。 */
  drainLiveWrites(): Promise<unknown[]>;
  /** 存储行的 revision 串（storeIdentity:incarnation:…）。 */
  revisionOf(row: SessionRow): SessionPersistenceRevision;
}
