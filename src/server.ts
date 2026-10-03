import { createServer, Server } from 'node:http';
import type { ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { InputError } from './rational.js';
import { buildReport, compareLimits, parseD, INPUT_VERSION, MAX_D, MAX_INPUT_DIGITS } from './service.js';
import { openDb, insertCalculation, getCalculation, listCalculations, SnapshotPayload } from './store.js';

export interface AppContext {
  db: DatabaseSync;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function errorBody(code: string, message: string, index?: number) {
  return { ok: false as const, error: { code, message, ...(index !== undefined ? { index } : {}) } };
}

async function readJson(req: { on: Function }): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req as any) chunks.push(Buffer.from(c));
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new InputError('INVALID_JSON', '请求体不是合法 JSON');
  }
}

function computeAndStore(db: DatabaseSync, input: string, D: bigint) {
  const report = buildReport(input, D);
  const snapshot: SnapshotPayload = {
    input,
    inputValue: report.inputValueFraction,
    maxDenominator: report.maxDenominator,
    inputVersion: report.inputVersion,
    result: report,
  };
  const id = insertCalculation(db, {
    input,
    inputValue: report.inputValueFraction,
    maxDenominator: report.maxDenominator,
    inputVersion: report.inputVersion,
    snapshot,
  });
  return { id, report };
}

export function createApp(db: DatabaseSync): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      // 健康检查与约束声明
      if (req.method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true, limits: { MAX_D: String(MAX_D), MAX_INPUT_DIGITS } });
      }

      // 单条计算 POST /api/approx { input, maxDenominator }
      if (req.method === 'POST' && path === '/api/approx') {
        const body = await readJson(req);
        if (typeof body.input !== 'string') {
          throw new InputError('MISSING_INPUT', '字段 input 必须为字符串');
        }
        const D = parseD(body.maxDenominator);
        const { id, report } = computeAndStore(db, body.input, D);
        return send(res, 200, { ok: true, id, report });
      }

      // 批量计算 POST /api/approx/batch { items: [{ input, maxDenominator }] }
      if (req.method === 'POST' && path === '/api/approx/batch') {
        const body = await readJson(req);
        if (!Array.isArray(body.items)) {
          throw new InputError('MISSING_ITEMS', '字段 items 必须为数组');
        }
        if (body.items.length > 1000) {
          throw new InputError('BATCH_TOO_LARGE', '批量条目不能超过 1000');
        }
        const results: unknown[] = [];
        body.items.forEach((item: any, index: number) => {
          try {
            if (typeof item?.input !== 'string') {
              throw new InputError('MISSING_INPUT', '字段 input 必须为字符串');
            }
            const D = parseD(item.maxDenominator);
            const { id, report } = computeAndStore(db, item.input, D);
            results.push({ index, ok: true, id, report });
          } catch (err: any) {
            const code = err instanceof InputError ? err.code : 'INTERNAL';
            const message = err instanceof Error ? err.message : String(err);
            results.push({ index, ok: false, error: { code, message, index } });
          }
        });
        return send(res, 200, { ok: true, results });
      }

      // 上限对照 POST /api/compare { input, denominators: [..] }
      if (req.method === 'POST' && path === '/api/compare') {
        const body = await readJson(req);
        if (typeof body.input !== 'string') throw new InputError('MISSING_INPUT', '字段 input 必须为字符串');
        if (!Array.isArray(body.denominators) || body.denominators.length === 0) {
          throw new InputError('MISSING_DENOMINATORS', '字段 denominators 必须是非空数组');
        }
        if (body.denominators.length > 100) throw new InputError('COMPARE_TOO_LARGE', '对照分母不超过 100 个');
        const Ds = body.denominators.map((d: unknown) => parseD(d));
        const comparison = compareLimits(body.input, Ds);
        return send(res, 200, { ok: true, ...comparison });
      }

      // 历史列表 GET /api/history?limit=&offset=&input=&maxDenominator=
      if (req.method === 'GET' && path === '/api/history') {
        const rows = listCalculations(db, {
          limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
          offset: url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined,
          input: url.searchParams.get('input') ?? undefined,
          maxDenominator: url.searchParams.get('maxDenominator')
            ? Number(url.searchParams.get('maxDenominator'))
            : undefined,
        });
        return send(res, 200, { ok: true, count: rows.length, items: rows.map(serializeRow) });
      }

      // 单条历史（含完整解释快照）GET /api/history/:id
      const m = path.match(/^\/api\/history\/(\d+)$/);
      if (req.method === 'GET' && m) {
        const row = getCalculation(db, Number(m[1]));
        if (!row) return send(res, 404, errorBody('NOT_FOUND', '未找到该算例'));
        return send(res, 200, { ok: true, item: serializeRow(row) });
      }

      // 导出（CSV）GET /api/export
      if (req.method === 'GET' && path === '/api/export') {
        const rows = listCalculations(db, { limit: 500 });
        const header = 'id,created_at,input,input_value,max_denominator,input_version,best,exact_error\n';
        const csv =
          header +
          rows
            .map((r) => {
              const snap = JSON.parse(r.snapshot);
              const rep = snap.result;
              return [r.id, r.created_at, csvCell(r.input), r.input_value, r.max_denominator,
                r.input_version, rep.bestFraction, rep.exactErrorFraction].join(',');
            })
            .join('\n');
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="calculations.csv"',
        });
        return res.end('\uFEFF' + csv);
      }

      return send(res, 404, errorBody('NOT_FOUND', `未知路径 ${path}`));
    } catch (err: any) {
      if (err instanceof InputError) {
        return send(res, 400, errorBody(err.code, err.message));
      }
      return send(res, 500, errorBody('INTERNAL', err?.message ?? String(err)));
    }
  });
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function serializeRow(r: any) {
  return {
    id: r.id,
    createdAt: r.created_at,
    input: r.input,
    inputValue: r.input_value,
    maxDenominator: r.max_denominator,
    inputVersion: r.input_version,
    schemaVersion: r.schema_version,
    snapshot: JSON.parse(r.snapshot),
  };
}

// 选择空闲端口：port=0 时由系统分配。
export function getFreePort(): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolveP(port));
      } else {
        srv.close(() => rejectP(new Error('无法获取空闲端口')));
      }
    });
    srv.on('error', rejectP);
  });
}

async function main() {
  const requested = process.env.PORT ? Number(process.env.PORT) : 0;
  const port = requested ? requested : await getFreePort();
  const dbPath = process.env.FRAC_DB_PATH ?? resolve('data/frac.db');
  const db = openDb(dbPath);
  const server = createApp(db);
  server.listen(port, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      status: 'listening',
      url: `http://127.0.0.1:${port}`,
      port,
      dbPath,
      inputVersion: INPUT_VERSION,
      maxDenominator: String(MAX_D),
      maxInputDigits: MAX_INPUT_DIGITS,
    }));
  });
}

// 仅在作为入口直接运行时启动（被测试 import 时不启动）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
