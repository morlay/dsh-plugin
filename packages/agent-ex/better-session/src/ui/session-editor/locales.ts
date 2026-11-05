// 消息动作行的文案字典：编辑（撤回回填）与重试两个动作，以及它们的确认框。
//
// 分叉不在这个字典里：它的入口在回合末尾（上游 `TurnTailNodeView` 的 `onBranch`），文案归上游 `chat` 命名空间。
//
// 与「对话管理」页面的字典分开：那个是页面文案，这些是聊天消息行上的动作文案，读者与生命周期都不同。
import { inject } from "@morlay/zephyr";
import { Locale, Slot, SlotContribution } from "@morlay/zephyr-app/client";

// 本包消息动作字典的 namespace。
export const NS = "sessionEditor";

// 简体中文是 key 真源。
export const zh = {
  edit: "编辑",
  "edit.title": "编辑消息",
  "edit.description": "将撤回该消息及其之后的对话内容到输入框，请修改后重新发送。",
  "edit.confirm": "撤回并编辑",
  retry: "重试此回合",
  "retry.title": "重试回合",
  "retry.description": "将重新生成第 {turn} 轮的回复，并抛弃该回合之后的内容。",
  "retry.confirm": "确认重试",
  cancel: "取消",
} satisfies Record<string, string>;

// 消息动作字典的 key 集合。
export type SessionEditorKey = keyof typeof zh;

// 英文对照表。
export const en = {
  edit: "Edit",
  "edit.title": "Edit message",
  "edit.description":
    "The message and everything after it are withdrawn into the composer; edit and send again.",
  "edit.confirm": "Withdraw and edit",
  retry: "Retry this turn",
  "retry.title": "Retry turn",
  "retry.description":
    "Regenerates the reply of turn {turn} and discards everything after that turn.",
  "retry.confirm": "Retry",
  cancel: "Cancel",
} satisfies Record<SessionEditorKey, string>;

/** 本包字典绑定后的翻译座：键集合就是字典的键集合。 */
export type SessionEditorTranslate = (
  key: SessionEditorKey,
  params?: Record<string, unknown>,
) => string;

// 字典面按结构使用：字典名只在本包注册，不扩张上游的 namespace 类型表。
interface Dictionaries {
  register(ns: string, dicts: Readonly<Record<string, Readonly<Record<string, string>>>>): unknown;
  bind(ns: string): SessionEditorTranslate;
}

/**
 * 本包消息动作字典的**唯一注册处**：上游 `locale.register` 对同一 namespace + locale 二次注册会抛，
 * 所以消息行只经这里 `bind`。
 */
@Slot({})
export class SessionEditorLocales extends SlotContribution {
  private readonly locale = inject(Locale) as unknown as Dictionaries;

  override onInit(): void {
    this.locale.register(NS, { zh, en });
    super.onInit();
  }

  /** 本包字典绑定后的翻译座。 */
  t(): SessionEditorTranslate {
    return this.locale.bind(NS);
  }
}
