/**
 * 本包字典（命名空间 `settings.schema-form`）：表单壳、字段控件与只读呈现的文案。
 *
 * 字段自身的人话标签不在这里（那是业务方经字段槽或 schema `description` 给的），这里只放**机制**文案。
 */

/** 中文文案（部署语言偏好是 zh）。 */
export const zh = {
  unavailable: "该插件当前未加载，暂时无法配置。",
  readOnly: "本部署的设置为只读。",
  save: "保存",
  confirmEdit: "确认",
  cancelEdit: "取消",
  saving: "保存中…",
  saveFailed: "本部署没有接受这些值，已保留供你修改。",
  noSchema: "这一行没有可自动生成的配置项。",

  reset: "恢复默认",
  revert: "撤回",
  invalid: "这个值不被接受。",
  invalidNumber: "需要一个数字。",
  invalidInteger: "需要一个整数。",
  invalidJson: "需要一段合法的 JSON。",
  invalidBoolean: "需要 true 或 false。",
  invalidConst: "这个字段只接受固定值。",
  unknownProperty: "这一层没有这个字段：从上面的候选里选，或换个键名。",
  empty: "（空）",

  toggleGroup: "展开 / 收起这一层",
  switchVariant: "切换这一层的形状或分支",
  copyValue: "复制值",
  copied: "已复制",
  addProperty: "添加属性",
  addItemPaste: "添加数组项（可粘贴 JSON 字符串）",
  addItem: "添加一项",
  removeItem: "移除",
  addKey: "添加键（可粘贴 JSON 字符串）",
  keyName: "键名",
  noKeys: "还没有键。",
  noItems: "还没有项。",

  deprecated: "已废弃",
  experimental: "试验中",
  secretSet: "已配置",
  secretUnset: "未配置",
  secretHint: "留空即保留已存的值。",

  constValue: "固定值",
  notEditable: "这一项由插件在运行时提供，不能在页面上编辑。",
  recursive: "递归结构：展开到这一层为止。",
  fixedLength: "固定长度",
  bitsetHint: "可多选。",
  unconfigured: "未配置",
  readOnlyField: "只读",
  noDescription: "（无说明）",
  required: "必填",
  duplicateItem: "重复的 {key}：{value}",
  missingItem: "每一项都需要一个 {key}",
} as const;

/** 英文文案。 */
export const en = {
  unavailable: "This plugin is not loaded, so it cannot be configured right now.",
  readOnly: "This deployment stores settings read-only.",
  save: "Save",
  confirmEdit: "Confirm",
  cancelEdit: "Cancel",
  saving: "Saving…",
  saveFailed: "This deployment did not accept these values; they are kept for you to fix.",
  noSchema: "This row has no configuration to generate.",

  reset: "Reset",
  revert: "Revert",
  invalid: "This value is not accepted.",
  invalidNumber: "Enter a number.",
  invalidInteger: "Enter a whole number.",
  invalidJson: "Enter valid JSON.",
  invalidBoolean: "Enter true or false.",
  invalidConst: "This field only accepts its fixed value.",
  unknownProperty: "No such field at this level: pick one of the candidates above.",
  empty: "(empty)",

  toggleGroup: "Expand or collapse this level",
  switchVariant: "Switch this level's shape or branch",
  copyValue: "Copy value",
  copied: "Copied",
  addProperty: "Add property",
  addItemPaste: "Add item (a JSON string can be pasted)",
  addItem: "Add item",
  removeItem: "Remove",
  addKey: "Add key (a JSON string can be pasted)",
  keyName: "Key",
  noKeys: "No keys yet.",
  noItems: "No items yet.",

  deprecated: "deprecated",
  experimental: "experimental",
  secretSet: "configured",
  secretUnset: "not set",
  secretHint: "Leave blank to keep the stored value.",

  constValue: "fixed",
  notEditable: "This entry is provided by the plugin at runtime and cannot be edited here.",
  recursive: "Recursive structure: expanded down to this level.",
  fixedLength: "fixed length",
  bitsetHint: "Multiple choices.",
  unconfigured: "not configured",
  readOnlyField: "read-only",
  noDescription: "(no description)",
  required: "required",
  duplicateItem: "Duplicate {key}: {value}",
  missingItem: "Every item needs a {key}",
} as const;

/** 本命名空间的字典键。 */
export type SchemaFormLocaleKey = keyof typeof zh;
