// 规则的唯一 owner：启动时读一次 `{DSH_HOME}/sandbox.toml`，之后不再变（本部署没有配置页）。
//
// 坏配置不阻断启动——用户写坏一份 toml 不该让宿主起不来。四种坏法一个口径：整份配置按"没有规则"处理，
// 并 warn 一条点名（文件路径 + 坏在哪）。不认识的字段也算坏：多写一个键说明这份文件不是本版本认的形状，
// 挑一半字段生效比一条都不生效更难查。
import { parse } from "smol-toml";
import { inject, Injectable, Logger, type Context, type OnInit } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { SandboxFile } from "./contract/sandbox-file.contract.ts";
import { SandboxRules, type SandboxSettings } from "./contract/sandbox-rules.contract.ts";
import { ruleSourceOf, type RuleSource } from "./rules.ts";

// 认得的顶层字段；其余一律按坏配置处理。
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "access",
  "runnerCommand",
  "runnerFailureSignatures",
  "probeTimeoutMs",
  "cwd",
  "diffBasisMaxBytes",
]);

// 每次新建：模块级常量会被多个实例（多个 app）共享，前一个用例的规则会漏到后一个。
function emptySource(): RuleSource {
  return { allowWrite: [], readOnly: [], deny: [] };
}

/**
 * 缺省规则。
 *
 * `cwd`（相对路径的解析基准）由调用方给 `AppEnv` 的起始目录——环境事实只有那一个来源。
 * 每次新建：模块级常量会被多个实例（多个 app）共享，前一个用例的规则会漏到后一个。
 * @param cwd - 相对路径的解析基准。
 * @returns 一份全新的缺省设置。
 */
function defaults(cwd: string): SandboxSettings {
  return {
    access: [],
    runnerCommand: [],
    runnerFailureSignatures: [],
    probeTimeoutMs: 5_000,
    cwd,
    diffBasisMaxBytes: 10 * 1024 * 1024,
  };
}

function strings(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`"${field}" must be an array of strings`);
  }
  return value as readonly string[];
}

/**
 * 规则条目：**数组与多行字符串两种写法都收**。
 *
 * TOML 里最顺手的写法是块标量（`access = """\nrw /tmp\n"""`，一行一条），源部署的 patch 就是那个形状；
 * 只认数组会让那份配置整份被当成坏文件退到空规则——症状是沙箱静默只剩工作区可写。
 * 空行丢弃（块标量首尾的空行是写法带来的，不是规则）。
 * @param value - 文档里的 `access` 字段。
 * @returns 一条条规则文本。
 */
function accessEntries(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return strings(value, "access");
}

function positiveInteger(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`"${field}" must be a positive integer`);
  }
  return value;
}

function text(value: unknown, field: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`"${field}" must be a non-empty string`);
  }
  return value;
}

@Injectable()
export class SandboxRulesDefault extends SandboxRules implements OnInit {
  private readonly file = inject(SandboxFile);

  private readonly logger = inject(Logger);

  /**
   * `cwd` 缺省的来源：`AppEnv.defaultWorkingDirectory`。
   *
   * 注入而不是在缺省值里读 `process.cwd()`：环境事实只有一个来源，
   * 打包形态下进程 cwd 不是用户的项目目录。
   */
  private readonly appEnv = inject(AppEnv);

  // 惰性建：字段初始化器那一刻 `inject(AppEnv)` 还只是占位，读不到真值。
  private state: SandboxSettings | undefined;

  private readonly rules: RuleSource = emptySource();

  async onInit(_ctx: Context): Promise<void> {
    const raw = await this.file.read();
    if (raw === undefined) return;
    const loaded = this.load(raw);
    if (loaded === undefined) return;
    Object.assign(this.settings(), loaded.settings);
    Object.assign(this.rules, loaded.source);
  }

  settings(): SandboxSettings {
    this.state ??= defaults(this.appEnv.defaultWorkingDirectory);
    return this.state;
  }

  source(): RuleSource {
    return this.rules;
  }

  // 解析一份 toml；任何一处坏掉都给 `undefined`（= 沿用默认值与空规则），并 warn 一条点名。
  private load(raw: string): { settings: SandboxSettings; source: RuleSource } | undefined {
    let document: Record<string, unknown>;
    try {
      document = parse(raw) as Record<string, unknown>;
    } catch (error) {
      return this.degraded(`is not valid TOML (${String(error)})`);
    }

    const unknown = Object.keys(document).filter((key) => !KNOWN_KEYS.has(key));
    if (unknown.length > 0) {
      return this.degraded(`has unknown field(s) ${unknown.join(", ")}`);
    }

    const base = this.settings();
    let settings: SandboxSettings;
    try {
      settings = {
        access: accessEntries(document["access"]),
        runnerCommand: strings(document["runnerCommand"], "runnerCommand"),
        runnerFailureSignatures: strings(
          document["runnerFailureSignatures"],
          "runnerFailureSignatures",
        ),
        probeTimeoutMs: positiveInteger(
          document["probeTimeoutMs"],
          "probeTimeoutMs",
          base.probeTimeoutMs,
        ),
        cwd: text(document["cwd"], "cwd", base.cwd),
        diffBasisMaxBytes: positiveInteger(
          document["diffBasisMaxBytes"],
          "diffBasisMaxBytes",
          base.diffBasisMaxBytes,
        ),
      };
    } catch (error) {
      return this.degraded(`has a wrongly typed field (${String(error)})`);
    }

    try {
      return { settings, source: ruleSourceOf(settings.access, process.env) };
    } catch (error) {
      // 条目坏掉时整份规则都不用：半套规则比没有规则更危险。
      this.warn(`has an unusable access entry (${String(error)})`);
      return undefined;
    }
  }

  private degraded(reason: string): undefined {
    this.warn(reason);
    return undefined;
  }

  private warn(reason: string): void {
    this.logger.warn(
      `configurable-sandbox: ${this.file.path} ${reason}, so no sandbox rules are applied`,
    );
  }
}
