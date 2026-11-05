// spec 写的是**输入形状**（字段可省略），本仓的 `ModeConfig` 是归一化之后的形状（全必填）。
// 这层适配集中在这里：spec 只提供输入，归一化由实现做。
export function asModeConfig(value: object): import("../../endpoint/mode-config.ts").ModeConfig {
  return value as unknown as import("../../endpoint/mode-config.ts").ModeConfig;
}
