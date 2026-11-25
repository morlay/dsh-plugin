// PTC 运行时契约：令牌按服务语义命名（上游注册名 `ptcRuntime`）。
import type NodePtcRuntimeService from "@deepseek-ai/dsh-ptc-runtime-node";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

/** 能力词汇：把 JSON Schema 转成 TypeScript 类型字面量（PTC 的程序里给模型看的那种，纯函数）。 */
export { jsonSchemaToTs } from "@deepseek-ai/dsh-tool-executor-ptc";

@Injectable({ name: "ptcRuntime" })
export abstract class PtcRuntime {
  abstract readonly executionInstructions: NodePtcRuntimeService["executionInstructions"];

  abstract readonly isolation: NodePtcRuntimeService["isolation"];

  abstract readonly language: NodePtcRuntimeService["language"];

  abstract readonly programFormat: NodePtcRuntimeService["programFormat"];

  abstract readonly release: NodePtcRuntimeService["release"];

  abstract readonly resolve: NodePtcRuntimeService["resolve"];

  abstract readonly run: NodePtcRuntimeService["run"];

  abstract readonly sandboxMode: NodePtcRuntimeService["sandboxMode"];

  abstract readonly timeout: NodePtcRuntimeService["timeout"];

  abstract readonly retainsState: NodePtcRuntimeService["retainsState"];

  /** 注册每个新环境执行一次的初始化源码（上游 0.2.3 新增；返回注销函数）。 */
  abstract readonly registerEnvironmentInitializer: NodePtcRuntimeService["registerEnvironmentInitializer"];
}

/**
 * 覆盖守卫（严格）：上游 `NodePtcRuntimeService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type PtcRuntimeCovered = AssertTrue<AssertCoveredStrict<NodePtcRuntimeService, PtcRuntime>>;
