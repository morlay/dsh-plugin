/**
 * 桌面形态的传输接管：把 Web 应用的浏览器装配换成「宿主内直连」。
 *
 * 两件事：一是让 `connection` 的浏览器认证在桌面下直接放行（页面由壳独占，没有网络入口）；
 * 二是把客户端的 transport 行注入 index，并注册它访问的 `/.dsh/remote-stream`（请求体首行定
 * endpoint/payload、后续行是逻辑流的上行项，响应体是下行 NDJSON）。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { TypertGatewayWireStream } from "@deepseek-ai/dsh-api-gateway";
import type { Context } from "@deepseek-ai/cordis";
import { DESKTOP_STREAM_PATH, DesktopStreamBodyDecoder } from "./wire.ts";

export { DESKTOP_STREAM_PATH } from "./wire.ts";

/** 注入 index 的 transport 行：声明页面拥有 Host，并给出 Gateway 流载体（下行流 + 上行项）。 */
export const DESKTOP_TRANSPORT_SCRIPT = `globalThis.__DSH_TRANSPORT__={
  _desktop:true,
  ownsHost:true,
  async *openStream(endpoint,payload,signal,uplink){
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
    const stream=carrier.open(endpoint,payload,{
      chunk(text){append(text)},
      end(){
        if(buffer!==''){queue.push(JSON.parse(buffer));buffer=''}
        ended=true
        notify()
      },
      fail(message){failure=new Error(message);ended=true;notify()},
    })
    // 取消必须结束迭代：abort 只解除 IPC 监听，挂在这一句等待上的消费方再也收不到
    // end 帧；不叫醒它就等于 dispose（RemoteStream 会 await iterator.return）永不落定——
    // 撤回 / 重试后的窗口重建正是卡在这里，页面既收不到新窗口也没有报错。
    const onAbort=()=>{stream.cancel();ended=true;notify()}
    signal.addEventListener('abort',onAbort,{once:true})
    if(signal.aborted)onAbort()
    // 上行（客户端 → 宿主）是逻辑流的输入项：逐条交给主进程，收尾时结束请求体；
    // 没有 uplink 的流（如 $events）立刻结束请求体，宿主侧不用等一个永不来的 end。
    if(uplink===undefined)stream.end()
    else void (async()=>{
      try{
        for await(const item of uplink){
          // 取消后不再上行：宿主那边这条逻辑流已经作废。
          if(signal.aborted)break
          stream.send(item)
        }
      }catch(error){
        console.error('[dsh-desktop] stream uplink failed for',endpoint,error)
      }finally{
        stream.end()
      }
    })()
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
console.info('[dsh-desktop] transport installed',Object.keys(globalThis.__DSH_TRANSPORT__))`;
interface BrowserAuthSurface {
  requestRejection(request: unknown): number | undefined;
  authorizeIndex(request: unknown, response: unknown): boolean;
}

interface GatewaySurface {
  // 直接用上游导出的签名（而不是抄一份）：它变参数时我们编译即报错——0.1.7 把 uplink 加进
  // `open` 时，抄下来的三参版本正是这样静默失效成运行时 TypeError 的。
  readonly wireStream: Pick<TypertGatewayWireStream, "open">;
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

/** 桌面流请求体：首行是 open（endpoint / payload），后续每行是一道上行项。 */
async function* readStreamFrames(request: IncomingMessage): AsyncGenerator<unknown> {
  const decoder = new DesktopStreamBodyDecoder();
  for await (const chunk of request) {
    for (const frame of decoder.push(chunk as Uint8Array)) yield frame;
  }
  for (const frame of decoder.finish()) yield frame;
}

interface StreamOpening {
  readonly endpoint: string;
  readonly payload: unknown;
}

/** 校验首行：它决定这条流开在哪个 endpoint 上。 */
function parseStreamOpening(value: unknown, subject: string): StreamOpening {
  if (!isRecord(value) || typeof value.endpoint !== "string")
    throw new Error(`dsh desktop: invalid stream request ${subject}`);
  return { endpoint: value.endpoint, payload: value.payload ?? { args: {} } };
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
    const endpointFromQuery = new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get(
      "endpoint",
    );
    // 首行定流，其余行是上行项：`frames` 剩下的部分就是交给 Gateway 的 uplink。
    const frames = readStreamFrames(request);
    let opening: StreamOpening;
    try {
      const first = await frames.next();
      opening = first.done
        ? parseStreamOpening(
            endpointFromQuery === null ? undefined : { endpoint: endpointFromQuery },
            String(request.url),
          )
        : parseStreamOpening(first.value, String(request.url));
    } catch (error) {
      reportStreamFailure("stream body is not a valid opener", error);
      response.writeHead(400);
      response.end("invalid stream request");
      return;
    }
    const endpoint = opening.endpoint;
    const abort = new AbortController();
    const cancel = (): void => {
      abort.abort();
    };
    request.once("aborted", cancel);
    response.once("close", cancel);
    try {
      console.error(`[dsh-desktop] stream opening ${endpoint}`);
      // 上游 0.1.7 的契约是五参：uplink 是「客户端 → 宿主」的逻辑流输入，$events 那类
      // Gateway 自己的流会被上游立刻释放（releaseUplink），不读这里的项。
      const values = await gateway.wireStream.open(
        endpoint,
        opening.payload,
        frames,
        undefined,
        abort.signal,
      );
      console.error(`[dsh-desktop] stream opened ${endpoint}`);
      response.writeHead(200, {
        "content-type": "application/x-ndjson",
        "cache-control": "no-store",
      });
      for await (const value of values) response.write(`${JSON.stringify(value)}\n`);
      response.end();
    } catch (error) {
      reportStreamFailure(`stream ${endpoint} failed`, error);
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
