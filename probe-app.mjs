const deadline = Date.now() + 240_000;
const evalIn = async (expression) => {
  let list;
  try { list = await (await fetch("http://127.0.0.1:9223/json/list")).json(); } catch { return undefined; }
  const target = list.find((t) => (t.url ?? "").includes("://app"));
  if (target === undefined) return undefined;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  return await new Promise((resolve) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(undefined); }, 5000);
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
for (;;) {
  const text = await evalIn("document.body.innerText.slice(0, 200)");
  if (text !== undefined && text.trim() !== "" && !/^not found$/iu.test(text.trim())) {
    console.log("[页面] 渲染出来了:", JSON.stringify(text.slice(0, 200)));
    break;
  }
  if (Date.now() > deadline) { console.log("[页面] 超时，仍是:", JSON.stringify(String(text).slice(0, 200))); break; }
  await new Promise((r) => setTimeout(r, 5000));
}
