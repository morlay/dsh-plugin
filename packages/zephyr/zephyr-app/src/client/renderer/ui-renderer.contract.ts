// 应用挂载面（上游 `uiRenderer` 的 `mount`）：挂载整棵已装配的 UI，返回卸载函数。
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class UiRenderer {
  abstract mount(container: HTMLElement): () => void;
}
