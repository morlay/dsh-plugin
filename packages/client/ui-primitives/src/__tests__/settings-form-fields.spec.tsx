// @vitest-environment jsdom
// 搬自 vendor/deepseek-harness/packages/client/ui-primitives/tests/settings-fields.client.spec.tsx
// （上游判据逐条照搬，导入面换成我们的 client 出口）；末尾一条 help 折叠是本仓库补的。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSecretField, SettingsValueField } from "@morlay/dsh-client-ui-primitives/client";
import { styles as formStyles } from "../client/settings-form/SettingsForm.styles.ts";
import { styles as fieldStyles } from "../client/settings-form/fields.styles.ts";
import { Styling } from "../client/styling/styling.ts";

afterEach(cleanup);

const frame = {
  id: "field",
  label: "Command timeout",
  hint: "How long one command may run.",
  overriddenLabel: "Overridden",
  resetLabel: "Reset to default",
  invalidLabel: "Enter a number.",
  disabled: false,
  overridden: false,
  invalid: false,
};

describe("SettingsValueField", () => {
  it("stages every keystroke without writing", () => {
    const onEdit = vi.fn();
    render(<SettingsValueField {...frame} text="60000" onEdit={onEdit} onReset={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Command timeout"), { target: { value: "9000" } });

    expect(onEdit).toHaveBeenCalledWith("9000");
  });

  it("renders the staged text it is given rather than a draft of its own", () => {
    const { rerender } = render(
      <SettingsValueField {...frame} text="60000" onEdit={vi.fn()} onReset={vi.fn()} />,
    );
    expect(screen.getByLabelText("Command timeout")).toHaveProperty("value", "60000");

    rerender(<SettingsValueField {...frame} text="9000" onEdit={vi.fn()} onReset={vi.fn()} />);

    expect(screen.getByLabelText("Command timeout")).toHaveProperty("value", "9000");
  });

  it("offers the reset only while an override would stand", () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <SettingsValueField {...frame} text="9000" onEdit={vi.fn()} onReset={onReset} />,
    );
    expect(screen.queryByRole("button", { name: "Reset to default" })).toBeNull();

    rerender(
      <SettingsValueField {...frame} overridden text="9000" onEdit={vi.fn()} onReset={onReset} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(screen.getByText("Overridden")).toBeTruthy();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("replaces the hint with the reason an invalid draft cannot be saved", () => {
    render(
      <SettingsValueField {...frame} invalid text="soon" onEdit={vi.fn()} onReset={vi.fn()} />,
    );

    expect(screen.getByText("Enter a number.")).toBeTruthy();
    expect(screen.queryByText("How long one command may run.")).toBeNull();
    expect(screen.getByLabelText("Command timeout").getAttribute("aria-invalid")).toBe("true");
  });

  it("hints a numeric keypad and renders a placeholder when asked", () => {
    render(
      <SettingsValueField
        {...frame}
        numeric
        placeholder="https://api.deepseek.com"
        text=""
        onEdit={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Command timeout");

    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input).toHaveProperty("placeholder", "https://api.deepseek.com");
  });

  it("disables the control and its reset while the document is read-only", () => {
    render(
      <SettingsValueField
        {...frame}
        disabled
        overridden
        text="9000"
        onEdit={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Command timeout")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Reset to default" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  // 本仓库补：我们重写过 help 折叠（按钮的 aria 关系 + 面板的 region 语义），守它。
  it("discloses the help region beside the label and points the input at it", () => {
    render(
      <SettingsValueField
        {...frame}
        text="60000"
        help={{ label: "Format", content: <p>Whole milliseconds.</p> }}
        onEdit={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Format" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Whole milliseconds.")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("region", { name: "Format" });
    expect(screen.getByText("Whole milliseconds.")).toBeTruthy();
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
    expect(screen.getByLabelText("Command timeout").getAttribute("aria-describedby")).toContain(
      panel.id,
    );
  });
});

describe("SettingsSecretField", () => {
  const secret = {
    id: "key",
    label: "API key",
    hint: "Stored outside the settings file.",
    disabled: false,
  };

  it("stages the draft and never renders it", () => {
    const onEdit = vi.fn();
    render(
      <SettingsSecretField
        {...secret}
        text=""
        configured={false}
        stateLabel="No key is configured."
        onEdit={onEdit}
      />,
    );
    const input = screen.getByLabelText("API key");

    fireEvent.change(input, { target: { value: "ds-secret" } });

    expect(onEdit).toHaveBeenCalledWith("ds-secret");
    expect(input).toHaveProperty("type", "password");
  });

  // 本仓库补：口令框声明不参与「已存登录密码」的自动填充（上游 11c0511271 的修复）。
  it("asks the browser not to autofill a saved login password", () => {
    render(
      <SettingsSecretField
        {...secret}
        text=""
        configured={false}
        stateLabel="No key is configured."
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("API key").getAttribute("autocomplete")).toBe("new-password");
  });

  it("reports the configured state the Host holds", () => {
    const { rerender } = render(
      <SettingsSecretField
        {...secret}
        text=""
        configured={false}
        stateLabel="No key is configured."
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText("No key is configured.")).toBeTruthy();

    rerender(
      <SettingsSecretField
        {...secret}
        text="ds-secret"
        configured
        stateLabel="A key is configured."
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("A key is configured.")).toBeTruthy();
    expect(screen.getByLabelText("API key")).toHaveProperty("value", "ds-secret");
  });

  it("disables the control when it is told to", () => {
    render(
      <SettingsSecretField
        {...secret}
        disabled
        text=""
        configured
        stateLabel="A key is configured."
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("API key")).toHaveProperty("disabled", true);
  });
});

// 焦点环口径搬上游 `focus.css` 的表达式：颜色读官方 `--dsw-focus-ring-color`
// （主题按输入模态解析成蓝），变量缺失时回退 `--dsw-alias-state-business-primary`。
describe("设置表单的焦点环", () => {
  const FOCUS_RING =
    "var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))";

  it("帮助按钮与保存按钮的 :focus-visible 外框读官方焦点变量", () => {
    const local = Styling.create();
    local.props(fieldStyles.helpButton);
    local.props(formStyles.save);

    const sheets = local.sheets().join("\n");
    expect(sheets).toContain("outline: var(--dsw-focus-ring-width) solid var(");
    expect(sheets).toContain(FOCUS_RING);
  });

  it("输入框的 :focus-visible 边框用业务蓝", () => {
    const local = Styling.create();
    local.props(fieldStyles.input);

    expect(local.sheets().join("\n")).toContain(
      "border-color: var(--dsw-alias-state-business-primary)",
    );
  });
});
