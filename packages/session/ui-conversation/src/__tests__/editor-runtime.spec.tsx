// @vitest-environment jsdom
// 输入框保留 raw markdown：草稿文本不再被纯文本引用装饰（`@scope/name` 这类 prose 不再高亮）。
// 引用解析留给发出后的解析层（`findReferences` / `ReferenceMarkdown`）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { $getRoot, $getSelection, $isRangeSelection, SELECTION_CHANGE_COMMAND } from "lexical";
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

// jsdom 里 `focus()` 会清空 Selection、Range 也没有几何：保住 Chromium 的「选区跟随焦点」行为。
function keepRangeOnFocus(element: HTMLElement): () => void {
  const focus = element.focus.bind(element);
  const spy = vi.spyOn(element, "focus").mockImplementation((options) => {
    const selection = document.getSelection();
    const range =
      selection === null || selection.rangeCount === 0
        ? undefined
        : selection.getRangeAt(0).cloneRange();
    focus(options);
    if (selection !== null && range !== undefined) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
  return () => {
    spy.mockRestore();
  };
}

function focusBench(): {
  runtime: DraftEditorRuntime;
  root: HTMLDivElement;
  outside: HTMLButtonElement;
} {
  const geometry = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  const runtime = new DraftEditorRuntime({
    onUpdate: () => {},
    openReference: () => false,
    activeClaimToken: () => null,
  });
  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  const outside = document.createElement("button");
  document.body.append(root, outside);
  const restoreFoci = [keepRangeOnFocus(root), keepRangeOnFocus(outside)];
  runtime.editor.setRootElement(root);
  const unregister = runtime.register();
  live.push(() => {
    unregister();
    for (const restore of restoreFoci) restore();
    root.remove();
    outside.remove();
    if (geometry === undefined) Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    else Object.defineProperty(Range.prototype, "getBoundingClientRect", geometry);
  });
  return { runtime, root, outside };
}

function draftSelection(runtime: DraftEditorRuntime): {
  anchor: number;
  focus: number;
  text: string;
} {
  return runtime.editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) throw new Error("草稿里应有一个范围选区");
    return {
      anchor: selection.anchor.offset,
      focus: selection.focus.offset,
      text: selection.getTextContent(),
    };
  });
}

function domSelection(): { anchor: number; focus: number; text: string } {
  const selection = document.getSelection();
  if (selection === null) throw new Error("文档里应有一个选区");
  return {
    anchor: selection.anchorOffset,
    focus: selection.focusOffset,
    text: selection.toString(),
  };
}

describe("DraftEditorRuntime: 外部焦点不被草稿选区拉回", () => {
  it("焦点交给输入框外的控件后，草稿选区与 DOM 选区都不再被后台协调改写", () => {
    const { runtime, root, outside } = focusBench();
    runtime.setDraft("alpha beta");
    root.focus();
    runtime.editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]!.select(1, 4);
      },
      { discrete: true },
    );
    const internal = draftSelection(runtime);
    const dom = domSelection();
    expect(internal).toEqual({ anchor: 1, focus: 4, text: "lph" });
    expect(dom).toEqual({ anchor: 1, focus: 4, text: "lph" });

    outside.focus();
    runtime.editor.read(() => {});
    expect(document.activeElement).toBe(outside);
    expect(draftSelection(runtime)).toEqual(internal);
    expect(domSelection()).toEqual(dom);

    runtime.editor.update(
      () => {
        $getRoot().getFirstDescendant()!.markDirty();
      },
      { discrete: true },
    );
    expect(document.activeElement).toBe(outside);
    expect(draftSelection(runtime)).toEqual(internal);
    expect(domSelection()).toEqual(dom);

    runtime.editor.update(
      () => {
        runtime.editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
      },
      { discrete: true },
    );
    expect(document.activeElement).toBe(outside);
    expect(draftSelection(runtime)).toEqual(internal);
    expect(domSelection()).toEqual(dom);
  });
});
