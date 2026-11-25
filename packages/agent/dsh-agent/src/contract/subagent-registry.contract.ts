// subagent 运行时契约：令牌按服务语义命名（上游注册名 `subagents`）。
//
// 上游类直接取自它自己的包：契约面不经过 `../server`（那是 wire 面），否则契约一旦被引用就把
// 宿主侧实现拖进依赖图。
import type { SubagentRuntime } from "@deepseek-ai/dsh-subagent";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

@Injectable({ name: "subagents" })
export abstract class SubagentRegistry {
  abstract readonly resolveMaxDepth: SubagentRuntime["resolveMaxDepth"];

  abstract readonly startActivation: SubagentRuntime["startActivation"];

  /** 这一层子代理树的根（上游按 caller 往上找）。 */
  abstract readonly rootOf: SubagentRuntime["rootOf"];

  /** 树里的成员名（诊断与按名寻址）。 */
  abstract readonly namesOf: SubagentRuntime["namesOf"];

  /** 把一个名字解析成会话身份（名字只在树内唯一）。 */
  abstract readonly resolveName: SubagentRuntime["resolveName"];

  /** 等整棵树上的工作收尾（父等子、子等孙）。 */
  abstract readonly waitForTreeWork: SubagentRuntime["waitForTreeWork"];

  abstract readonly drainDescendants: SubagentRuntime["drainDescendants"];

  abstract readonly getProvider: SubagentRuntime["getProvider"];

  abstract readonly interrupt: SubagentRuntime["interrupt"];

  /** 用户侧的打断（与父侧打断分开：权限不同）。 */
  abstract readonly interruptByUser: SubagentRuntime["interruptByUser"];

  abstract readonly listDescendants: SubagentRuntime["listDescendants"];

  abstract readonly prompt: SubagentRuntime["prompt"];

  /** 某一层子代理树的容量：在跑数与上限（上游 0.2.3 新增）。 */
  abstract readonly capacityOf: SubagentRuntime["capacityOf"];

  /** 当前配置的子代理并发上限（上游 0.2.3 新增的 volatile 配置读口）。 */
  abstract readonly maxActiveSubagents: SubagentRuntime["maxActiveSubagents"];

  abstract readonly registerProvider: SubagentRuntime["registerProvider"];

  abstract readonly sendMessage: SubagentRuntime["sendMessage"];

  abstract readonly typertRemote: SubagentRuntime["typertRemote"];
}

/**
 * 覆盖守卫（严格）：上游 `SubagentRuntime` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type SubagentRegistryCovered = AssertTrue<AssertCoveredStrict<SubagentRuntime, SubagentRegistry>>;
