import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createConversationService } from "./service.js";

const MAX_BODY_BYTES = 64 * 1024;

function equalToken(actual, expected) {
  const left = Buffer.from(String(actual ?? ""));
  const right = Buffer.from(String(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        const error = new Error("Request body too large.");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { const error = new Error("Invalid JSON body."); error.statusCode = 400; reject(error); }
    });
    request.on("error", reject);
  });
}

export function renderConversationHtml(token) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'">
<title>Kairo Conversation</title><style>
:root{color-scheme:dark;font:15px system-ui;background:#111;color:#eee}body{max-width:900px;margin:0 auto;padding:24px}textarea{width:100%;min-height:90px;background:#1d1d1d;color:#fff;border:1px solid #555;padding:10px;box-sizing:border-box}button{margin:8px 8px 0 0;padding:8px 12px}.card{border:1px solid #444;border-radius:8px;padding:14px;margin:12px 0}.muted{color:#aaa}.error{color:#ff9b9b}.ok{color:#9ee6a8}pre{white-space:pre-wrap;background:#181818;padding:12px}</style></head><body>
<h1>Kairo Conversation</h1><p class="muted">Approval and execution are separate. Claude starts only after explicit confirmation.</p>
<form id="architect"><label for="task">Architecture task</label><textarea id="task" required></textarea><br><button>Create plan with Codex</button></form>
<p id="status" class="muted"></p><section id="timeline"></section>
<script>const TOKEN=${JSON.stringify(token)};
const statusEl=document.getElementById('status'), timeline=document.getElementById('timeline');
async function api(path,options={}){const response=await fetch(path,{...options,headers:{authorization:'Bearer '+TOKEN,'content-type':'application/json',...(options.headers||{})}});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data}
function button(label,action,id){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{if(action==='execute'&&!window.confirm('Execute this approved plan with Claude using safe subscription-only mode?'))return;try{statusEl.textContent=label+'…';const options=action==='show'?{}:{method:'POST',body:'{}'};const result=await api('/api/plans/'+encodeURIComponent(id)+'/'+action,options);if(action==='show'){const pre=document.createElement('pre');pre.textContent=result.planMarkdown||'No plan artifact yet.';b.parentElement.appendChild(pre)}await refresh()}catch(e){statusEl.textContent=e.message;statusEl.className='error'}};return b}
async function refresh(){const data=await api('/api/snapshot');timeline.replaceChildren();for(const plan of data.timeline){const card=document.createElement('article');card.className='card';const title=document.createElement('strong');title.textContent=plan.taskId+' · '+plan.state;card.append(title,document.createElement('br'));const note=document.createElement('span');note.className='muted';note.textContent=plan.execution.message;card.append(note,document.createElement('br'));if(plan.planReady)card.append(button('Open plan','show',plan.taskId));if(plan.state==='awaiting_approval'){card.append(button('Approve','approve',plan.taskId),button('Reject','reject',plan.taskId))}if(plan.state==='approved'&&plan.execution.state==='not_started')card.append(button('Execute with Claude','execute',plan.taskId));if(plan.execution.active)card.append(button('Cancel Claude run','cancel',plan.taskId));timeline.append(card)}statusEl.textContent='';statusEl.className='muted'}
document.getElementById('architect').onsubmit=async(event)=>{event.preventDefault();const task=document.getElementById('task').value.trim();if(!task)return;statusEl.textContent='Codex is planning in read-only mode…';try{await api('/api/architect',{method:'POST',body:JSON.stringify({task})});document.getElementById('task').value='';await refresh()}catch(e){statusEl.textContent=e.message;statusEl.className='error'}};refresh().catch(e=>{statusEl.textContent=e.message;statusEl.className='error'});setInterval(()=>refresh().catch(()=>{}),2000);</script></body></html>`;
}

function requestAllowed(request, port, token, url) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowedHosts.has(request.headers.host)) return { ok: false, status: 403, error: "Invalid Host header." };
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) {
    return { ok: false, status: 403, error: "Invalid Origin header." };
  }
  const bearer = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const supplied = url.pathname === "/" ? url.searchParams.get("token") : bearer;
  if (!equalToken(supplied, token)) return { ok: false, status: 401, error: "Invalid UI token." };
  return { ok: true };
}

function routeFor(method, pathname) {
  if (method === "GET" && pathname === "/") return { action: "html" };
  if (method === "GET" && pathname === "/api/snapshot") return { action: "snapshot" };
  if (method === "POST" && pathname === "/api/architect") return { action: "architect" };
  const match = pathname.match(/^\/api\/plans\/([a-z0-9][a-z0-9-]{0,95})\/(show|approve|reject|execute|cancel)$/);
  if (!match) return null;
  if ((match[2] === "show" && method !== "GET") || (match[2] !== "show" && method !== "POST")) return null;
  return { action: match[2], taskId: match[1] };
}

export async function startLocalConversationUi({ cwd, port = 0, token, service } = {}) {
  const authToken = token ?? randomBytes(24).toString("hex");
  const app = service ?? createConversationService();
  let boundPort = port;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${boundPort}`);
    const gate = requestAllowed(request, boundPort, authToken, url);
    if (!gate.ok) return sendJson(response, gate.status, { error: gate.error });
    const route = routeFor(request.method, url.pathname);
    if (!route) return sendJson(response, 404, { error: "Unknown endpoint." });
    try {
      if (route.action === "html") {
        const html = renderConversationHtml(authToken);
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
          "x-frame-options": "DENY", "x-content-type-options": "nosniff"
        });
        response.end(html);
      } else if (route.action === "snapshot") sendJson(response, 200, await app.snapshot({ cwd }));
      else if (route.action === "architect") {
        const body = await readJson(request);
        if (typeof body.task !== "string" || !body.task.trim() || body.task.length > 20_000) {
          return sendJson(response, 400, { error: "Task must be a non-empty string up to 20000 characters." });
        }
        sendJson(response, 200, await app.submitArchitecture({ cwd, task: body.task, model: body.model ?? null }));
      } else if (route.action === "show") sendJson(response, 200, await app.showPlan({ cwd, taskId: route.taskId }));
      else if (route.action === "approve" || route.action === "reject") {
        sendJson(response, 200, await app.decidePlan({
          cwd, taskId: route.taskId, decision: route.action === "approve" ? "approved" : "rejected"
        }));
      } else if (route.action === "execute") {
        sendJson(response, 202, await app.executePlan({ cwd, taskId: route.taskId }));
      } else sendJson(response, 200, await app.cancelExecution({ cwd, taskId: route.taskId }));
    } catch (error) {
      if (!response.headersSent) sendJson(response, error.statusCode ?? 400, { error: error.message ?? String(error) });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  boundPort = server.address().port;
  return {
    server,
    token: authToken,
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/?token=${authToken}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

export async function runUiCli(options, deps = {}) {
  const ui = await (deps.start ?? startLocalConversationUi)({ cwd: options.cwd, port: options.port ?? 0 });
  console.log(`Kairo UI: ${ui.url}`);
  if (deps.waitForShutdown) return deps.waitForShutdown(ui);
  await new Promise((resolve) => {
    const stop = () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); resolve(); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  await ui.close();
}
