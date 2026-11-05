// 归档面的读口：删除只允许已归档的会话，列表默认不含归档。
//
// 惰性可选：装配里没有归档服务时，列表退回持久化里的归档标记，删除则不做"先取消归档"。
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class SessionArchiveRegistry {
  abstract readonly archivedSessionIds: readonly string[];

  abstract unarchiveSession(sessionId: string): Promise<void>;
}
