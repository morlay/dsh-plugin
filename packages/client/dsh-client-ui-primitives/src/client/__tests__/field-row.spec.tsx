// @vitest-environment jsdom
// 字段行：两种排法（同列 / 控件贴右）、分隔线、"已覆盖"徽标与恢复默认、非法提示。
//
// 盯的接缝是**字段的摆位**：控件由调用方给（这里给一个占位节点），行只负责标签、说明、徽标、分隔线与排法。

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import rowCss from "../settings-form/SettingsFieldRow.module.css";
import { SettingsFieldRow } from "../settings-form/SettingsFieldRow.tsx";

afterEach(cleanup);

describe("字段行", () => {
  it("同列排法：标签 / 控件 / 说明依次出现，非法提示排在最后", () => {
    render(
      <SettingsFieldRow label="允许的工具" hint="留空 = 不限制" invalid="认不出的工具">
        <input aria-label="控件" />
      </SettingsFieldRow>,
    );

    const row = screen.getByText("允许的工具").closest("[data-divider]") as HTMLElement;
    expect(row.getAttribute("data-role")).toBe("field-row");
    const text = row.textContent ?? "";
    expect(text.indexOf("允许的工具")).toBeLessThan(text.indexOf("留空 = 不限制"));
    expect(screen.getByRole("alert").textContent).toBe("认不出的工具");
  });

  it("右置排法：左列是标签与说明，右列是控件", () => {
    render(
      <SettingsFieldRow label="工作区指令" hint="每步都发" layout="inline">
        <button type="button" role="switch" aria-label="工作区指令" />
      </SettingsFieldRow>,
    );

    const row = screen.getByText("工作区指令").closest("[data-divider]") as HTMLElement;
    const inline = row.children[0] as HTMLElement;
    expect(inline.children).toHaveLength(2);
    expect(inline.children[0]?.textContent).toContain("工作区指令");
    expect(inline.children[0]?.textContent).toContain("每步都发");
    expect(inline.children[1]?.getAttribute("role")).toBe("switch");
  });

  it("分隔线跟着 `divider` 走（这一组里不是第一个字段才有）", () => {
    const { rerender } = render(
      <SettingsFieldRow label="名称" hint="显示名">
        <input aria-label="控件" />
      </SettingsFieldRow>,
    );
    expect(
      (screen.getByText("名称").closest("[data-divider]") as HTMLElement).getAttribute(
        "data-divider",
      ),
    ).toBe("false");

    rerender(
      <SettingsFieldRow label="名称" hint="显示名" divider>
        <input aria-label="控件" />
      </SettingsFieldRow>,
    );
    const row = screen.getByText("名称").closest("[data-divider]") as HTMLElement;
    expect(row.getAttribute("data-divider")).toBe("true");
    // 分隔线本身（0.5px 细线）归 `SettingsFieldRow.module.css`：这里只认行带上了那个类。
    expect(row.className).toContain(rowCss.row);
  });

  it("被用户层覆盖：给徽标与恢复默认入口，点一下就回调", () => {
    const onReset = vi.fn();
    render(
      <SettingsFieldRow
        label="名称"
        hint="显示名"
        overriddenLabel="已覆盖"
        resetLabel="恢复默认"
        onReset={onReset}
      >
        <input aria-label="控件" />
      </SettingsFieldRow>,
    );

    expect(screen.getByText("已覆盖")).toBeTruthy();
    screen.getByRole("button", { name: "恢复默认" }).click();
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
