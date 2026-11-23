// AI features via Kompass (DotKonnekt's AI platform). Two workflows in the "Snack Overflow" project (tenant devtest):
//   Chat    — food Q&A + plain-English HR commands → { type: "answer", text } | { type: "command", command } | { type: "unknown" }
//   Extract — task "menu": messy menu → { weekStart, weekEnd, days, warnings }; task "feedback": comments → { summary, themes }
// Needs KOMPASS_PROJECT_ID (in bot/.env, gitignored; the project id is the only credential). Without it, AI is off and the bot
// behaves exactly as before. Workflow ids are not secret, so they default here.
const path = require("path");

try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {} // no bot/.env: fine, use the shell's env

const BASE = process.env.KOMPASS_URL || "https://aistudio-apigateway-v2-dev.sangria.tech/api/v2/flows/execute/";
const CHAT_FLOW = process.env.KOMPASS_CHAT_FLOW_ID || "59827c83-7624-4c11-9f53-587d63345b17";
const EXTRACT_FLOW = process.env.KOMPASS_EXTRACT_FLOW_ID || "e7bbf123-3ae2-425e-860f-e68b60138196";

const enabled = () => !!process.env.KOMPASS_PROJECT_ID;

// Runs a workflow and returns its output (parsed JSON). Throws on HTTP/workflow errors or timeout.
async function runFlow(flowId, inputs) {
  const res = await fetch(BASE + flowId, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "X-Tenant-ID": process.env.KOMPASS_TENANT || "devtest",
      "project-id": process.env.KOMPASS_PROJECT_ID,
    },
    body: JSON.stringify({ inputs }),
    signal: AbortSignal.timeout(45000), // menu parsing takes ~10 s
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !body.success) {
    throw new Error(`Kompass ${res.status}: ${(body && body.message) || "no response body"}`);
  }
  let out = body.data && body.data.output;
  if (typeof out === "string") {
    try { out = JSON.parse(out); } catch { /* leave as text */ }
  }
  return out;
}

const chat = (inputs) => runFlow(CHAT_FLOW, inputs);
const extract = (task, text, today) => runFlow(EXTRACT_FLOW, { task, text, today });

module.exports = { enabled, runFlow, chat, extract };
