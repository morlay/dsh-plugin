// 字段行：设置面上"一个字段"的容器——标签、控件、说明、非法提示与"已覆盖"徽标都由它摆位置。
// 两种排法按控件的宽度选：输入类（stack）是标签 / 控件 / 说明同列，切换类（inline）把控件贴最右。
// 留白与分隔线的口径与官方 `SettingsValueField` 一致（上下各 12px、相邻 0.5px 细线）。

import type { HTMLAttributes, ReactNode } from "react";
import { styling } from "../styling/styling.ts";
import { styles } from "./fields.styles.ts";

export interface SettingsFieldRowProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "color"> {
  // 字段名。
  label: string;
  // 字段下面那句说明（"这一项到底管什么"）。
  hint: string;
  // 控件的摆法：`stack`（同列，输入类，缺省）或 `inline`（控件贴右，切换类）。
  layout?: "stack" | "inline";
  // 与上一个字段之间画一条细分隔线（这一组里不是第一个字段时为 true）。
  divider?: boolean;
  // 字段被用户层覆盖时的徽标文案；不给就不显示。
  overriddenLabel?: string;
  // 恢复默认的入口：给了它与 `resetLabel` 才显示（覆盖用户层那一项）。
  resetLabel?: string;
  onReset?: () => void;
  // 非法提示；不给就只说合法的那些。
  invalid?: string;
  children: ReactNode;
}

export function SettingsFieldRow({
  label,
  hint,
  layout = "stack",
  divider = false,
  overriddenLabel,
  resetLabel,
  onReset,
  invalid,
  children,
  ...rest
}: SettingsFieldRowProps): ReactNode {
  const container = {
    ...styling.props(styles.row),
    "data-role": "field-row",
    ...(divider ? styling.props(styles.rowDivider) : {}),
    "data-divider": divider ? "true" : "false",
    ...rest,
  };
  const labelNode = (
    <span {...styling.props(styles.rowLabel)}>
      {label}
      {overriddenLabel === undefined ? null : (
        <>
          <span {...styling.props(styles.rowBadge)}>{overriddenLabel}</span>
          {resetLabel === undefined || onReset === undefined ? null : (
            <button
              type="button"
              {...styling.props(styles.reset)}
              onClick={() => {
                onReset();
              }}
            >
              {resetLabel}
            </button>
          )}
        </>
      )}
    </span>
  );
  const invalidNode =
    invalid === undefined ? null : (
      <p {...styling.props(styles.invalid)} role="alert">
        {invalid}
      </p>
    );
  if (layout === "inline") {
    return (
      <div {...container}>
        <div {...styling.props(styles.rowInline)}>
          <div {...styling.props(styles.rowText)}>
            {labelNode}
            <p {...styling.props(styles.hint)}>{hint}</p>
          </div>
          {children}
        </div>
        {invalidNode}
      </div>
    );
  }
  return (
    <div {...container}>
      <div {...styling.props(styles.rowBody)}>
        {labelNode}
        {children}
        <p {...styling.props(styles.hint)}>{hint}</p>
      </div>
      {invalidNode}
    </div>
  );
}
