/**
 * 启动页与失败报告：**framework-free**，与上游 `@deepseek-ai/dsh-client-web/src/boot-page` 一致。
 *
 * 插件开始注册到 UI 渲染器接管挂载点之间，页面上先是它——React 要等 `ui-renderer` 才到，那之前必须有个
 * 不依赖框架的东西能把"正在加载"与"失败了"显示出来（否则就是白屏，而原因只有 console 里看得见）。
 *
 * @module @morlay/zephyr-app/client/app-boot/boot-page
 */
/** 装配期一行的状态投影（对应上游的 `LoaderEntryState`，这里只关心这四态）。 */
export type BootEntryState = "pending" | "loading" | "active" | "failed";

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className ?? "";
  if (text !== undefined) el.textContent = text;
  return el;
}

/** 内核自己的启动页：挂在应用挂载点里面，直到 UI 渲染器接管。 */
export class BootPage {
  private readonly root: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly wordmark: HTMLDivElement;
  private readonly spinner: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly states = new Map<string, BootEntryState>();
  private readonly active = new Set<string>();
  private total = 0;
  private failure: string | undefined;

  /**
   * Build and attach the boot page.
   *
   * @param container - Application mount point.
   */
  constructor(container: HTMLElement) {
    this.root = div("dsh-boot");
    this.root.dataset["dshBoot"] = "";
    this.card = div("dsh-boot-card");
    this.wordmark = div("dsh-boot-wordmark", "HARNESS");
    this.spinner = div("dsh-boot-spinner");
    this.spinner.dataset["dshBootSpinner"] = "";
    this.hint = div("dsh-boot-hint", "Loading plugins…");
    this.card.append(this.wordmark, this.spinner, this.hint);
    this.root.append(this.card);
    container.append(this.root);
    this.updateProgress();
  }

  /**
   * Set the number of assembly rows represented by the progress arc.
   *
   * @param total - Complete boot roster size.
   */
  setTotal(total: number): void {
    this.total = total;
    this.updateProgress();
  }

  /**
   * Project one row's state.
   *
   * @param id - Row (package) name.
   * @param state - Projected state.
   */
  setState(id: string, state: BootEntryState): void {
    this.states.set(id, state);
    if (state === "active") this.active.add(id);
    this.updateProgress();
    this.render();
  }

  /**
   * Display the boot failure report.
   *
   * @param message - Failure report text.
   */
  fail(message: string): void {
    this.failure = message;
    this.render();
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  dispose(): void {
    this.root.remove();
  }

  /** Redraw the state-dependent content below the wordmark. */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === "failed").map(([id]) => id);
    if (this.failure === undefined && failed.length === 0) {
      if (this.spinner.parentElement !== this.card) {
        this.card.replaceChildren(this.wordmark, this.spinner, this.hint);
      }
      return;
    }
    const report = div("dsh-boot-failed");
    report.append(div("dsh-boot-failed-title", "Failed to load plugins"));
    for (const id of failed) report.append(div("dsh-boot-failed-item", id));
    if (this.failure !== undefined) report.append(div("dsh-boot-failed-item", this.failure));
    this.card.replaceChildren(this.wordmark, report);
  }

  /** Grow the rotating arc monotonically as rows activate. */
  private updateProgress(): void {
    const ratio = this.total === 0 ? 0 : Math.min(this.active.size / this.total, 1);
    this.spinner.style.setProperty("--dsh-boot-arc", `${String(Math.round(72 + ratio * 216))}deg`);
  }
}
