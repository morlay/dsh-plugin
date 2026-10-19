// 会话控制面契约：令牌按服务语义命名（上游注册名 `sessionController`）。
import { Injectable } from "@morlay/zephyr";

interface SessionControllerFace {}

@Injectable()
export abstract class SessionController implements SessionControllerFace {}
