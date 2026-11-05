import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import { LlmAdapter } from "../server/index.ts";

/**
 * 假 LLM adapter：不联网，一次性把一句话吐完。`calls` 是"模型被调用了几次"的证据。
 *
 * 它继承 `LlmAdapter`（宿主半的值面）：这是**跨层**的测试替身——所以从 `@morlay/dsh-agent/server`
 * 的 `LlmAdapter` 派生，而本文件仍住在 `./testing`（下游只 import 这里，不 import `./server`）。
 */
export class FakeLlmAdapter extends LlmAdapter {
  /** 被调用次数。 */
  calls = 0;

  /**
   * @param reply - 固定回这一句。
   */
  constructor(private readonly reply = "这是假模型的回复。") {
    super();
  }

  async *stream(): AsyncIterable<StreamChunk> {
    this.calls += 1;
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: this.reply };
    yield { type: "block-end", index: 0, block: { type: "text", text: this.reply } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}
