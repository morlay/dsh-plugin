// session-title seam 的契约：令牌按服务语义命名（上游注册名 `sessionTitle`）。
import type SessionTitleService from "@deepseek-ai/dsh-session-title";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

// `foldSessionTitle`（从会话日志折标题的纯函数）**不在这里**：它在上游宿主包根上，按值转出会给
// 契约面收一条运行时边，契约面被 ui 引用，宿主行（连带 `@deepseek-ai/dsh-session` 根）就会进浏览器
// bundle。纯值走包根（宿主面）：见 `src/index.ts`。

@Injectable({ name: "sessionTitle" })
export abstract class SessionTitle {
  abstract readonly get: SessionTitleService["get"];

  abstract readonly rename: SessionTitleService["rename"];

  abstract readonly refresh: SessionTitleService["refresh"];

  abstract readonly register: SessionTitleService["register"];
}

/**
 * 覆盖守卫（严格）：上游 `SessionTitleService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type SessionTitleCovered = AssertTrue<AssertCoveredStrict<SessionTitleService, SessionTitle>>;
