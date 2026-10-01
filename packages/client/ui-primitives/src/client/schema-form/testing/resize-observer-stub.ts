// jsdom 里跑官方 `Tooltip`、以及靠 `scrollWidth` / `clientWidth` 判截断的行内文本的环境替身。
//
// 官方气泡的宽度/定位来自 `ResizeObserver` 回调（`visibility` 也只在那个回调里置为 visible），而 jsdom 没有这个
// API：缺了它，hover 之后的 effect 会直接抛 `ReferenceError`。替身做两件事：注册时喂回一次 `borderBoxSize`
// （让气泡进入可见态），并给用例一个 `notifyResize()`——真机上「盒子宽度变了」是浏览器通知的，jsdom 里没有那个
// 事件，用例只能自己发一次。
//
// 它**不是**几何证据：真尺寸与定位只能在浏览器里量（本包 `.agents/standards/how-to-verify.md` 记了这条与探针的
// 用法），所以用例的判据是「hover 出气泡、气泡里是全文」，不拿替身去断言气泡的实际尺寸。

interface StubObserver {
  readonly targets: Set<Element>;
  readonly notify: ResizeObserverCallback;
}

const live = new Set<StubObserver>();

export function stubResizeObserver(): void {
  class ResizeObserverStub {
    #notify: ResizeObserverCallback;
    #targets = new Set<Element>();
    #live: StubObserver;

    constructor(notify: ResizeObserverCallback) {
      this.#notify = notify;
      this.#live = { targets: this.#targets, notify };
      live.add(this.#live);
    }

    // 注册即回调一次（真实的 ResizeObserver 也会在首帧给一次初始尺寸）。
    observe(target: Element): void {
      this.#targets.add(target);
      this.#notify([entry(target)], this as unknown as ResizeObserver);
    }

    unobserve(target: Element): void {
      this.#targets.delete(target);
    }

    disconnect(): void {
      this.#targets.clear();
      live.delete(this.#live);
    }
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

// 让还活着的替身观察者再收到一次尺寸通知：用例把元素的几何改掉之后调它，等价于浏览器通知「这个盒子变了」。
export function notifyResize(): void {
  for (const observer of live) {
    const entries = [...observer.targets].map((target) => entry(target));
    if (entries.length > 0) {
      observer.notify(entries, undefined as unknown as ResizeObserver);
    }
  }
}

function entry(target: Element): ResizeObserverEntry {
  return {
    target,
    borderBoxSize: [{ blockSize: 0, inlineSize: 0 }],
  } as unknown as ResizeObserverEntry;
}
