// `RemoteHandlers` 的实现：两张表（方法路由 + 事件频道），生命周期跟着注册方走。
import { Injectable } from "@morlay/zephyr";
import {
  RemoteHandlers,
  type RemoteEventListener,
  type RemoteHandler,
  type RemoteStreamHandler,
} from "./remote-handlers.contract.ts";

@Injectable()
export class RemoteHandlersDefault extends RemoteHandlers {
  private readonly handlers = new Map<string, RemoteHandler>();

  private readonly streams = new Map<string, RemoteStreamHandler>();

  private readonly listeners = new Map<string, Set<RemoteEventListener>>();


  register(endpoint: string, handler: RemoteHandler): () => void {
    if (this.handlers.has(endpoint)) {
      throw new Error(`[remote] ${endpoint} 已经注册过：一个 endpoint 只能有一个实现`);
    }
    this.handlers.set(endpoint, handler);
    return () => {
      this.handlers.delete(endpoint);
    };
  }

  registerStream(endpoint: string, handler: RemoteStreamHandler): () => void {
    if (this.streams.has(endpoint) || this.handlers.has(endpoint)) {
      throw new Error(`[remote] ${endpoint} 已经注册过：一个 endpoint 只能有一个实现`);
    }
    this.streams.set(endpoint, handler);
    return () => {
      this.streams.delete(endpoint);
    };
  }

  stream(
    endpoint: string,
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): AsyncIterable<unknown> | undefined {
    return this.streams.get(endpoint)?.(args, signal);
  }

  async invoke(endpoint: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = this.handlers.get(endpoint);
    if (handler === undefined) {
      throw new Error(`[remote] ${endpoint} 没有实现：检查对应的服务有没有注册它`);
    }
    return handler(args);
  }

  subscribe(channel: string, listener: RemoteEventListener): () => void {
    const set = this.listeners.get(channel) ?? new Set<RemoteEventListener>();
    set.add(listener);
    this.listeners.set(channel, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(channel);
    };
  }

  publish(channel: string, ...args: readonly unknown[]): void {
    for (const listener of Array.from(this.listeners.get(channel) ?? [])) listener(...args);
  }
}
