// 压缩引擎契约：令牌按服务语义命名（上游注册名 `compaction`）。
import { CompactionEngine } from "@deepseek-ai/dsh-compaction";
import { Injectable } from "@morlay/zephyr";

@Injectable({ name: "compaction" })
export abstract class Compaction implements CompactionEngine {
  abstract readonly compactIfNeeded: CompactionEngine["compactIfNeeded"];

  abstract readonly compactNow: CompactionEngine["compactNow"];

  abstract readonly compactRegion: CompactionEngine["compactRegion"];
}
