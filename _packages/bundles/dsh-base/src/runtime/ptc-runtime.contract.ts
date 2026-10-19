// PTC 运行时契约：令牌按服务语义命名（上游注册名 `ptcRuntime`）。
import { Injectable } from "@morlay/zephyr";

interface PtcRuntimeFace {}

@Injectable()
export abstract class PtcRuntime implements PtcRuntimeFace {}
