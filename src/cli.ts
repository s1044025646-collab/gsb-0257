import { ApproxService } from "./service.js";
import { Store, defaultDbPath } from "./store.js";
import { startServer } from "./server.js";
import { MAX_DENOMINATOR, MAX_INPUT_DIGITS } from "./parse.js";
import fs from "node:fs";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function print(r: ReturnType<ApproxService["compute"]>["result"]): void {
  console.log(`输入:        ${r.input.raw}  (= ${r.input.p}/${r.input.q} ≈ ${r.input.decimal})`);
  console.log(`最大分母 D:  ${r.maxDenominator}`);
  console.log(`结果:        ${r.result.p}/${r.result.q}  (≈ ${r.result.decimal})`);
  console.log(`精确误差:    ${r.error.p}/${r.error.q}  (≈ ${r.error.decimal})`);
  console.log(`是否精确:    ${r.exact ? "是（误差为零）" : "否"}`);
  console.log(`依据:        ${r.reason}`);
  console.log(`连分数:      [${r.continuedFraction.join("; ")}]`);
}

function main(): void {
  const [, , cmd, ...args] = process.argv;
  const dbPath = getFlag(args, "db") ?? defaultDbPath();

  if (cmd === "serve") {
    const portArg = getFlag(args, "port") ?? process.env.PORT;
    const port = portArg !== undefined ? Number(portArg) : 0; // 默认选择空闲端口
    startServer(port, dbPath).then(({ port: p }) => {
      console.log(`API 服务已启动: http://localhost:${p}  (数据库: ${dbPath})`);
    });
    return;
  }

  const service = new ApproxService(new Store(dbPath));
  try {
    switch (cmd) {
      case "calc": {
        const input = args[0];
        const d = getFlag(args, "d");
        if (input === undefined || d === undefined) throw new Error("用法: calc <输入> --d <最大分母> [--db 路径] [--no-save]");
        const { id, result } = service.compute(input, d, !args.includes("--no-save"));
        print(result);
        if (id !== null) console.log(`记录 ID:    ${id}`);
        break;
      }
      case "batch": {
        const file = getFlag(args, "file") ?? args[0];
        if (!file) throw new Error("用法: batch <items.json>  (数组，元素为 {input, maxDenominator})");
        const items = JSON.parse(fs.readFileSync(file, "utf8"));
        const results = service.batch(items, !args.includes("--no-save"));
        for (const r of results) {
          if (r.ok) {
            console.log(`#${r.index} ${r.input} D=${r.maxDenominator} -> ${r.result!.result.p}/${r.result!.result.q} 误差 ${r.result!.error.p}/${r.result!.error.q} (id=${r.id})`);
          } else {
            console.log(`#${r.index} ${r.input} 失败 [${r.error!.code}] ${r.error!.message}`);
          }
        }
        const failed = results.filter((r) => !r.ok).length;
        console.log(`共 ${results.length} 条，成功 ${results.length - failed} 条，失败 ${failed} 条`);
        if (failed > 0) process.exitCode = 2;
        break;
      }
      case "compare": {
        const input = args[0];
        const limits = (getFlag(args, "d") ?? "").split(",").filter(Boolean);
        if (!input || limits.length === 0) throw new Error("用法: compare <输入> --d 10,113,1000");
        for (const c of service.compare(input, limits, !args.includes("--no-save"))) {
          console.log(`D=${c.maxDenominator}  ->  ${c.result.p}/${c.result.q}  误差 ${c.error.p}/${c.error.q} (≈${c.error.decimal})`);
        }
        break;
      }
      case "steps": {
        const id = Number(args[0]);
        const rec = service.store.get(id);
        if (!rec) throw new Error(`记录 ${id} 不存在`);
        console.log(`记录 #${rec.id}  输入 ${rec.rawInput}  D=${rec.maxDenominator}  版本 ${rec.inputVersion}`);
        console.log(`连分数: [${rec.snapshot.continuedFraction.join("; ")}]`);
        for (const s of rec.snapshot.steps) {
          console.log(`  步骤${s.index}: a=${s.partialQuotient}  收敛 ${s.convergentP}/${s.convergentQ}  误差 ${s.error} (≈${s.errorDecimal}) ${s.withinLimit ? "" : "[超上限]"}`);
        }
        for (const c of rec.snapshot.candidates) {
          console.log(`  候选(${c.kind}): ${c.p}/${c.q}  误差 ${c.error} (≈${c.errorDecimal})`);
        }
        break;
      }
      case "history": {
        const limit = Number(getFlag(args, "limit") ?? 20);
        for (const r of service.store.list(limit)) {
          console.log(`#${r.id} [${r.createdAt}] ${r.rawInput} D=${r.maxDenominator} -> ${r.snapshot.result.p}/${r.snapshot.result.q}`);
        }
        break;
      }
      case "export": {
        const out = getFlag(args, "out");
        const data = service.store.list(100000).map((r) => JSON.stringify(r)).join("\n") + "\n";
        if (out) { fs.writeFileSync(out, data); console.log(`已导出到 ${out}`); }
        else process.stdout.write(data);
        break;
      }
      case "config": {
        console.log(`最大分母上限: ${MAX_DENOMINATOR}`);
        console.log(`输入位数上限: ${MAX_INPUT_DIGITS}`);
        break;
      }
      default:
        console.log(`用法: node dist/cli.js <命令>
  calc <输入> --d <D>      单条近似（输入支持整数/小数/分数/带分数）
  batch <items.json>       批量计算（失败条目单独报告）
  compare <输入> --d a,b,c 上限对照
  steps <id>               查看连分数步骤与候选误差
  history [--limit N]      历史查询
  export [--out 文件]      导出 NDJSON
  serve [--port N]         启动 API（默认选择空闲端口）
  config                   查看公开上限`);
    }
  } catch (e) {
    const err = e as Error & { code?: string };
    console.error(`错误${err.code ? ` [${err.code}]` : ""}: ${err.message}`);
    process.exitCode = 1;
  } finally {
    service.store.close();
  }
}

main();
