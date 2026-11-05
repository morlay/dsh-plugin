// 规则面契约：`sandbox.toml` 解析后的装配事实与规则源。
//
// 两个实现（进程沙箱、文件围栏）都从这里取同一份规则——一份文件一个 owner。
import { Injectable } from "@morlay/zephyr";
import type { RuleSource } from "../rules.ts";

// `sandbox.toml` 的六个字段：启动时读一次，之后不再变（本部署没有配置页）。
export interface SandboxSettings {
  // 规则条目：`rw <路径>` / `r- <路径>` / `-- <模式>`。
  readonly access: readonly string[];
  // runner 启动命令；空数组表示按平台自带的链去选。
  readonly runnerCommand: readonly string[];
  // runner 命令"用不了"的判定片段（与 `runnerCommand` 成对）。
  readonly runnerFailureSignatures: readonly string[];
  // 探测 runner 可用性的超时（毫秒）。
  readonly probeTimeoutMs: number;
  // 相对路径的解析基准（文件围栏的 `cwd`）。
  readonly cwd: string;
  // 覆盖写差异的单侧字节上限。
  readonly diffBasisMaxBytes: number;
}

@Injectable()
export abstract class SandboxRules {
  // 装配事实（交给官方两个基类的配置）。
  abstract settings(): SandboxSettings;

  // 规则源（环境变量已在加载期展开）。文件缺失 / 损坏时是全空的一份。
  abstract source(): RuleSource;
}
