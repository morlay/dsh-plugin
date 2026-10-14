const deadline = Date.now() + 260_000;
const evalIn = async (expression) => {
  let list;
  try { list = await (await fetch("http://127.0.0.1:9223/json/list")).json(); } catch { return undefined; }
  const target = list.find((t) => (t.url ?? "").includes("://app"));
  if (target === undefined) return undefined;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  return await new Promise((resolve) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(undefined); }, 6000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression } }));
    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id !== 1) return;
      clearTimeout(timer);
      resolve(String(d.result?.result?.value ?? ""));
      try { ws.close(); } catch {}
    };
    ws.onerror = () => { clearTimeout(timer); resolve(undefined); };
  });
};
const probe = `JSON.stringify({root: document.querySelector("#root")?.children.length ?? -1, len: document.body.innerText.length})`;
for (;;) {
  const raw = await evalIn(probe);
  if (raw !== undefined && raw !== "") {
    const seen = JSON.parse(raw);
    if (seen.root > 0) { console.log("[页面] 渲染出来了：", raw); break; }
    if (Date.now() > deadline) { console.log("[页面] 超时，仍空：", raw); break; }
  } else if (Date.now() > deadline) { console.log("[页面] 超时，页面没起来"); break; }
  await new Promise((r) => setTimeout(r, 6000));
}
