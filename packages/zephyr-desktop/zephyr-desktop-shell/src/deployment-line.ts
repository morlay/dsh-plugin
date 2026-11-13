// 启动时报出**本层算出的部署路径**：一行、字段顺序固定，与 CLI 侧的 `[cli-mode]` 同字段即可直接对比。
//
// 为什么要有它：`desktop dev`（壳只当浏览器）、打包后的 app（装配面与数据根都是部署值）、`zephyr dev`
// （装配面 = 工作区）三者的装配根与缓存根不同，同名包因此可能解析到不同版本。这一行只说**壳这边的值是什么**，
// 不解释谁对——解析逻辑在应用侧。
import type { CliModeValues } from "@morlay/zephyr-cli";

/** 一行的输入。 */
export interface DeploymentLineInput {
  /** 壳的形态（`ZEPHYR_DESKTOP_MODE` 的判定结果）。 */
  readonly form: "dev" | "packaged";
  /** 交给应用的部署值（`shellMode()` 的结果）。 */
  readonly mode: CliModeValues;
  /** Electron 的 `app.getPath("userData")`；拿不到就是 `undefined`。 */
  readonly userData: string | undefined;
  /** 是否 `ZEPHYR_DESKTOP_PACKAGED=1`（同进程的宿主据此清空 `dev.include`）。 */
  readonly packaged: boolean;
}

/**
 * 拼启动那一行（字段顺序固定：mode / workspace / profileDir / dataDir / dataDirSpec / userData / packaged）。
 * @param input - 形态、部署值与 userData。
 * @returns 一行的文本（含 `[desktop-shell]` 前缀，不换行）。
 */
export function deploymentLineOf(input: DeploymentLineInput): string {
  return [
    "[desktop-shell]",
    `mode=${input.form}`,
    `workspace=${input.mode.workspace}`,
    `profileDir=${input.mode.profileDir}`,
    `dataDir=${input.mode.dataDir}`,
    `dataDirSpec=${input.mode.dataDirSpec}`,
    `userData=${input.userData ?? "?"}`,
    `packaged=${input.packaged ? "1" : "0"}`,
  ].join(" ");
}
