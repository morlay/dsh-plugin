// 代码执行通道：PTC 模式下用程序调用其它工具。
import type { ToolGroup } from "../types.ts";

export const CODE_GROUP: ToolGroup = {
  key: "code",
  title: "代码执行",
  injection: "init",
  guideline: "PTC：在程序里直接编排工具调用时用它。",
  lines: [
    {
      when: "present",
      text: "present：要单独访问的完整交付物（图片、Office 文档、表格、幻灯片）用它发布；已经内联展示过的结果不必重复。",
    },
    {
      when: "read",
      text: "文件引用：命令、配置表达式与代码块之外，提到已存在的文件就链接到它相对工作目录（或绝对路径）的完整路径；已知行号时加 #L24 或 #L24-L30；链接文本用文件名或清晰别名。",
    },
    {
      when: "run_code",
      text: "run_code：PTC 模式下唯一能直接调用的工具——别的工具都在程序里 `await tools.name(args)` 调；code 是 async 函数体，只把打印或返回的内容当输出。",
    },
  ],
  drops: ["tools:ptc-only", "ui:deliverable-file-references", "context:file-reference"],
  tools: [{ tool: "run_code", short: "用代码调用其它工具（PTC）" }],
};
