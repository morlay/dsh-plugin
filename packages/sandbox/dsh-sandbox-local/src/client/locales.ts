/** 本包在配置页上的字段文案（命名空间 `settings.sandbox-local`）。 */

export const zh = {
  access: "额外可写根与拒绝项",
  accessHint:
    "一行一条：`rw:<路径>` 追加可写根，`r-:<路径>` 只读，`--:<路径>` 拒绝；支持 `~`、环境变量与 glob。改完当场生效。",
} as const;

export const en: Record<keyof typeof zh, string> = {
  access: "Extra writable roots and refusals",
  accessHint:
    "One entry per line: `rw:<path>` grants a writable root, `r-:<path>` makes it read-only, `--:<path>` denies it; `~`, env templates, and globs work. Edits apply immediately.",
};

export type SandboxFieldLocaleKey = keyof typeof zh;
