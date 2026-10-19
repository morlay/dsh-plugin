// 压缩引擎契约：令牌按服务语义命名（上游注册名 `compaction`）。
import { Injectable } from "@morlay/zephyr";

interface CompactionFace {}

@Injectable()
export abstract class Compaction implements CompactionFace {}
