// 定时器契约：令牌按服务语义命名（上游注册名 `timer`）。
import { Injectable } from "@morlay/zephyr";

interface TimerFace {}

@Injectable()
export abstract class Timer implements TimerFace {}
