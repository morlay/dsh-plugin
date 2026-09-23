// @vitest-environment jsdom
// 输入框保留 raw markdown：草稿文本不再被纯文本引用装饰（`@scope/name` 这类 prose 不再高亮）。
// 引用解析留给发出后的解析层（`findReferences` / `ReferenceMarkdown`）。
import { afterEach, describe, expect, it } from "vitest";
import { DraftEditorRuntime } from "../client/input/editor/runtime.ts";

const live: (() => void)[] = [];

afterEach(() => {
  for (const dispose of live.splice(0)) dispose();
});

function bench(): { runtime: DraftEditorRuntime; root: HTMLDivElement } {
  const runtime = new DraftEditorRuntime({
    onUpdate: () => {},
    openReference: () => false,
    activeClaimToken: () => null,
  });
  const root = document.createElement("div");
  document.body.append(root);
  runtime.editor.setRootElement(root);
  const unregister = runtime.register();
  live.push(() => {
    unregister();
    root.remove();
  });
  return { runtime, root };
}

describe("DraftEditorRuntime: 输入框保留 raw markdown", () => {
  it("粘贴 @scope/name 形态的 prose 不产生引用装饰，文本原样保留", () => {
    const { runtime, root } = bench();
    const text = "看看 @morlay/dsh-reference 这个包";

    runtime.paste(text);
    runtime.refreshProjection();

    expect(root.querySelector("[data-composer-text-ref]")).toBeNull();
    expect(runtime.projection.clipboardText).toBe(text);
  });

  it("粘贴 @src/ 形态的路径同样保持纯文本", () => {
    const { runtime, root } = bench();

    runtime.paste("看 @src/a.ts 的实现");
    runtime.refreshProjection();

    expect(root.querySelector("[data-composer-text-ref]")).toBeNull();
    expect(runtime.projection.clipboardText).toBe("看 @src/a.ts 的实现");
  });
});
