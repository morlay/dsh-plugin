/**
 * 桌面形态的传输接管：把 Web 应用的浏览器装配换成「宿主内直连」。
 *
 * 两件事：一是让 `connection` 的浏览器认证在桌面下直接放行（页面由壳独占，没有网络入口）；
 * 二是把客户端的 transport 行注入 index，并注册它访问的 `/.dsh/remote-stream`（NDJSON）。
 */

import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import { DESKTOP_LAYOUT_FALLBACK_SCRIPT } from "./layout-fallback.ts";
import { DESKTOP_STREAM_PATH } from "./wire.ts";

export { DESKTOP_STREAM_PATH } from "./wire.ts";

/** 注入 index 的 transport 行：声明页面拥有 Host，并给出 Gateway 流载体。 */
export const DESKTOP_TRANSPORT_SCRIPT = `globalThis.__DSH_TRANSPORT__={
  _desktop:true,
  ownsHost:true,
  async *openStream(endpoint,payload,signal){
    console.info('[dsh-desktop] openStream',endpoint)
    const carrier=globalThis.__DSH_DESKTOP_STREAM__
    if(carrier===undefined){
      console.error('[dsh-desktop] stream carrier missing for',endpoint)
      throw new Error('desktop stream carrier is unavailable')
    }
    const queue=[]
    let buffer=''
    let ended=false
    let failure
    let wake
    const notify=()=>{const pending=wake;wake=undefined;if(pending)pending()}
    const append=(text)=>{
      buffer+=text
      let at
      while((at=buffer.indexOf('\\n'))!==-1){
        const line=buffer.slice(0,at)
        buffer=buffer.slice(at+1)
        if(line!=='')queue.push(JSON.parse(line))
      }
      notify()
    }
    const cancel=carrier.open(endpoint,payload,{
      chunk(text){append(text)},
      end(){
        if(buffer!==''){queue.push(JSON.parse(buffer));buffer=''}
        ended=true
        notify()
      },
      fail(message){failure=new Error(message);ended=true;notify()},
    })
    const onAbort=()=>{cancel()}
    signal.addEventListener('abort',onAbort,{once:true})
    try{
      for(;;){
        while(queue.length>0)yield queue.shift()
        if(failure!==undefined)throw failure
        if(ended)return
        await new Promise(resolve=>{wake=resolve})
      }
    }finally{
      signal.removeEventListener('abort',onAbort)
    }
  }
}
console.info('[dsh-desktop] transport installed',Object.keys(globalThis.__DSH_TRANSPORT__))`
interface BrowserAuthSurface {
  requestRejection(request: unknown): number | undefined;
  authorizeIndex(request: unknown, response: unknown): boolean;
}

interface GatewaySurface {
  readonly wireStream: {
    open(
      endpoint: string,
      payload: unknown,
      signal: AbortSignal,
    ): Promise<AsyncIterable<unknown>>;
  };
}

/**
 * 桌面形态下放行 `connection` 的两处浏览器认证：`requestRejection`（`/api` 路由与
 * 各插件 handler 的自查）与 `authorizeIndex`（`frontend-static` 的 index 渲染）。
 *
 * 页面由壳独占、没有网络入口，认证没有对象；这里直接改写服务实例的方法。
 */
export function takeOverDesktopAuthentication(ctx: Context): void {
  const connection = ctx.get("connection") as unknown as BrowserAuthSurface | undefined;
  if (connection === undefined)
    throw new Error("dsh desktop: the composition did not provide the connection service");
  if (
    typeof connection.requestRejection !== "function" ||
    typeof connection.authorizeIndex !== "function"
  )
    throw new Error(
      "dsh desktop: the connection service no longer exposes requestRejection / authorizeIndex; " +
        "desktop authentication takeover needs an update",
    );
  connection.requestRejection = () => undefined;
  connection.authorizeIndex = () => true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读请求体；管道上若迟迟不结束就放弃剩余体（桌面流只有 `$events` 一种，payload 固定）。 */
async function readJsonBody(request: IncomingMessage, timeoutMs = 500): Promise<unknown> {
  const chunks: Buffer[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = Promise.race([
    (async () => {
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
    })(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref();
    }),
  ]);
  await done;
  if (timer !== undefined) clearTimeout(timer);
  request.destroy?.();
  return chunks.length === 0 ? undefined : (JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
}

// 诊断行：桌面流是连接就绪的唯一来源，出问题时先看宿主 stderr 的这几行。
function reportStreamFailure(subject: string, detail: unknown): void {
  console.error(`[dsh-desktop] ${subject}: ${errorText(detail)}`);
}

function errorText(value: unknown): string {
  return value instanceof Error ? (value.stack ?? value.message) : String(value);
}

function streamHandler(ctx: Context): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    const gateway = ctx.get("typertGateway") as unknown as GatewaySurface | undefined;
    if (gateway === undefined) {
      reportStreamFailure("stream failed", "typertGateway service is missing");
      response.writeHead(503);
      response.end("gateway unavailable");
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      reportStreamFailure("stream body is not JSON", error);
      response.writeHead(400);
      response.end("body is not JSON");
      return;
    }
    const endpointFromQuery = new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("endpoint");
    if (!isRecord(body) && endpointFromQuery === null) {
      reportStreamFailure("empty stream request", String(request.url));
      response.writeHead(400);
      response.end("invalid stream request");
      return;
    }
    if (!isRecord(body)) body = { endpoint: endpointFromQuery, payload: { args: {} } };
    if (typeof body.endpoint !== "string") {
      reportStreamFailure("invalid stream request", JSON.stringify(body).slice(0, 200));
      response.writeHead(400);
      response.end("invalid stream request");
      return;
    }
    const abort = new AbortController();
    const cancel = (): void => {
      abort.abort();
    };
    request.once("aborted", cancel);
    response.once("close", cancel);
    try {
      console.error(`[dsh-desktop] stream opening ${body.endpoint}`);
      const values = await gateway.wireStream.open(body.endpoint, body.payload, abort.signal);
      console.error(`[dsh-desktop] stream opened ${body.endpoint}`);
      response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      for await (const value of values) response.write(`${JSON.stringify(value)}\n`);
      response.end();
    } catch (error) {
      reportStreamFailure(`stream ${body.endpoint} failed`, error);
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      response.writeHead(502);
      response.end(error instanceof Error ? error.message : String(error));
    }
  };
}

/** 注入 transport 行并注册 Gateway 流路由；随插件 fiber 一起撤销。 */
export function installDesktopTransport(ctx: Context): void {
  ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "script", placement: "head", text: DESKTOP_TRANSPORT_SCRIPT });
    table.push({ kind: "script", placement: "head", text: DESKTOP_LAYOUT_FALLBACK_SCRIPT });
  });
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: DESKTOP_STREAM_PATH,
        handler: streamHandler(ctx),
      }),
    "dsh-desktop: remote stream route",
  );
}
