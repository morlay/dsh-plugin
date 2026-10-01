// jsdom 里跑官方 `Tooltip` 的环境替身。
//
// 官方气泡的宽度/定位来自 `ResizeObserver` 回调（`visibility` 也只在那个回调里置为 visible），而 jsdom 没有这个
// API：缺了它，hover 之后的 effect 会直接抛 `ReferenceError`。替身只做一件事——注册时喂回一次 `borderBoxSize`，
// 让气泡进入可见态。
//
// 它**不是**几何证据：真尺寸与定位只能在浏览器里量（本包 `.agents/standards/how-to-verify.md` 记了这条与探针的
// 用法），所以用例的判据是「hover 出气泡、气泡里是全文」，不拿替身去断言气泡的实际尺寸。

export function stubResizeObserver(): void {
  class ResizeObserverStub {
    #notify: ResizeObserverCallback;

    constructor(notify: ResizeObserverCallback) {
      this.#notify = notify;
    }

    // 注册即回调一次（真实的 ResizeObserver 也会在首帧给一次初始尺寸）。
    observe(): void {
      const entry = {
        borderBoxSize: [{ blockSize: 0, inlineSize: 0 }],
      } as unknown as ResizeObserverEntry;
      this.#notify([entry], this as unknown as ResizeObserver);
    }

    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}
