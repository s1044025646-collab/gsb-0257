import http from "node:http";
import { ApproxService } from "./service.js";
import { Store, defaultDbPath } from "./store.js";
import { MAX_DENOMINATOR, MAX_INPUT_DIGITS } from "./parse.js";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("请求体不是合法 JSON"), { code: "BAD_JSON" });
  }
}

export function createServer(service: ApproxService): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/api/config") {
        return send(res, 200, {
          maxDenominator: MAX_DENOMINATOR.toString(),
          maxInputDigits: MAX_INPUT_DIGITS,
          inputVersion: "v1",
        });
      }
      if (req.method === "POST" && path === "/api/approx") {
        const body = (await readBody(req)) as { input?: unknown; maxDenominator?: unknown; save?: unknown };
        if (typeof body.input !== "string") {
          return send(res, 400, { error: { code: "BAD_TYPE", message: "input 必须是字符串" } });
        }
        const { id, result } = service.compute(body.input, String(body.maxDenominator ?? ""), body.save !== false);
        return send(res, 200, { id, result });
      }
      if (req.method === "POST" && path === "/api/approx/batch") {
        const body = (await readBody(req)) as { items?: unknown; save?: unknown };
        if (!Array.isArray(body.items)) {
          return send(res, 400, { error: { code: "BAD_TYPE", message: "items 必须是数组" } });
        }
        return send(res, 200, { results: service.batch(body.items as never[], body.save !== false) });
      }
      if (req.method === "POST" && path === "/api/approx/compare") {
        const body = (await readBody(req)) as { input?: unknown; limits?: unknown; save?: unknown };
        if (typeof body.input !== "string" || !Array.isArray(body.limits)) {
          return send(res, 400, { error: { code: "BAD_TYPE", message: "需要 input 字符串与 limits 数组" } });
        }
        return send(res, 200, { comparisons: service.compare(body.input, body.limits, body.save !== false) });
      }
      if (req.method === "GET" && path === "/api/history") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 500);
        const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
        return send(res, 200, { records: service["store"].list(limit, offset) });
      }
      const histMatch = /^\/api\/history\/(\d+)$/.exec(path);
      if (req.method === "GET" && histMatch) {
        const rec = service["store"].get(Number(histMatch[1]));
        if (!rec) return send(res, 404, { error: { code: "NOT_FOUND", message: "记录不存在" } });
        return send(res, 200, rec);
      }
      const stepsMatch = /^\/api\/history\/(\d+)\/steps$/.exec(path);
      if (req.method === "GET" && stepsMatch) {
        const rec = service["store"].get(Number(stepsMatch[1]));
        if (!rec) return send(res, 404, { error: { code: "NOT_FOUND", message: "记录不存在" } });
        return send(res, 200, {
          id: rec.id,
          continuedFraction: rec.snapshot.continuedFraction,
          steps: rec.snapshot.steps,
          candidates: rec.snapshot.candidates,
        });
      }
      if (req.method === "GET" && path === "/api/export") {
        const records = service["store"].list(100000, 0);
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": "attachment; filename=approximations.ndjson",
        });
        return res.end(records.map((r) => JSON.stringify(r)).join("\n") + "\n");
      }
      return send(res, 404, { error: { code: "NOT_FOUND", message: "未知路由" } });
    } catch (e) {
      const err = e as Error & { code?: string };
      const status = err.code && err.code !== "INTERNAL" ? 400 : 500;
      return send(res, status, { error: { code: err.code ?? "INTERNAL", message: err.message } });
    }
  });
}

export function startServer(port: number, dbPath = defaultDbPath()): Promise<{ server: http.Server; port: number }> {
  const service = new ApproxService(new Store(dbPath));
  const server = createServer(service);
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : port });
    });
  });
}
