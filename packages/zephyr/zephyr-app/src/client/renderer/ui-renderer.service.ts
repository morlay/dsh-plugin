// 应用挂载：自实现。上游 `apply` 里的 `uiRenderer.mount` 只是
// `mountApp(container, buildRenderApp({ ctx }))`，而 `mountApp` 是它的私有函数——
// 我们直接用 `react-dom/client` 做同样的事（`buildRenderApp` 是公开的）。
import { buildRenderApp } from "@deepseek-ai/dsh-client-ui-renderer/src/client/app.tsx";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Slots } from "./slots.contract.ts";
import { UiRenderer } from "./ui-renderer.contract.ts";

@Injectable()
export class UiRendererDefault extends UiRenderer implements OnInit {
  private readonly slots = inject(Slots);

  onInit(): void {
    // 挂载时才需要 ctx：`buildRenderApp` 只读 `ctx.slots`，用最小适配即可。
  }

  mount(container: HTMLElement): () => void {
    const app = buildRenderApp({ ctx: { slots: this.slots } as never });
    const root = createRoot(container);
    root.render(createElement(app as unknown as () => ReactNode));
    return () => {
      root.unmount();
    };
  }
}
