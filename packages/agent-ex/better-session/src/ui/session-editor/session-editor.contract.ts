// 会话编辑的动作面：消息渲染行经 slot 的 inject 面拿到这几个动作与它们的文案。
//
// 它是**浏览器半的契约**（进程内、非 wire）：页面只见动作，wire 细节在 `session-editor.store.ts`。

import type { CascadePolicy, EditableBlockKind } from "@morlay/better-session/endpoint";
import type { SessionEditorTranslate } from "./locales.ts";

// 一条可撤回的消息块：撤回用它定位到存储坐标与块序号。
export interface EditableMessageBlock {
  key: string;
  turn?: number;
  eventSeq: number;
  blockIndex: number;
  kind: EditableBlockKind;
  text: string;
  time: number;
}

// 属性式函数类型而非方法签名：这几个动作要被渲染面解构后直接调用，没有 `this` 可言。
export interface SessionEditorFace {
  retry: (turn: number, cascade: CascadePolicy) => Promise<boolean>;
  recall: (message: EditableMessageBlock, texts: readonly string[]) => Promise<boolean>;
  /** 从某条消息分叉：复制它之前的对话成新会话，原会话不动。 */
  fork: (atSeq: number) => Promise<boolean>;
  /** 动作行的文案：字典归本包（`locales.ts`），渲染面不写中文。 */
  editorT: SessionEditorTranslate;
}
