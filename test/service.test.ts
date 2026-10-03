import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../src/store.js";
import { ApproxService } from "../src/service.js";
import { startServer } from "../src/server.js";

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "approx-")), "test.db");
}

test("存储：保存、读取、修改上限不影响旧报告", () => {
  const db = tmpDb();
  const svc = new ApproxService(new Store(db));
  const { id } = svc.compute("3.141592653589793", "10");
  const rec1 = svc.store.get(id!)!;
  assert.equal(rec1.snapshot.result.p, "22");
  // 同一输入用不同 D 再算
  svc.compute("3.141592653589793", "113");
  const again = svc.store.get(id!)!;
  assert.equal(again.snapshot.result.p, "22"); // 旧报告不变
  assert.equal(again.inputVersion, "v1");
  svc.store.close();

  // 模拟重启：重新打开同一数据库
  const svc2 = new ApproxService(new Store(db));
  const rec2 = svc2.store.get(id!)!;
  assert.equal(rec2.snapshot.result.p, "22");
  assert.equal(rec2.snapshot.continuedFraction.length > 0, true);
  svc2.store.close();
});

test("批量：失败条目准确定位，成功条目不受影响", () => {
  const svc = new ApproxService(new Store(tmpDb()));
  const results = svc.batch([
    { input: "0.5", maxDenominator: 1 },
    { input: "1/0", maxDenominator: 10 },
    { input: "abc", maxDenominator: 10 },
    { input: "3.14", maxDenominator: 0 },
    { input: "22/7", maxDenominator: 7 },
  ]);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error!.code, "ZERO_DENOMINATOR");
  assert.equal(results[1].index, 1);
  assert.equal(results[2].error!.code, "BAD_FORMAT");
  assert.equal(results[3].error!.code, "BAD_DENOMINATOR_LIMIT");
  assert.equal(results[4].ok, true);
  svc.store.close();
});

test("API：端到端（含默认空闲端口、steps、history、export）", async () => {
  const { server, port } = await startServer(0, tmpDb());
  assert.ok(port > 0); // 默认选择空闲端口
  const base = `http://localhost:${port}`;
  try {
    const res = await fetch(`${base}/api/approx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "3.141592653589793", maxDenominator: "113" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: number; result: { result: { p: string; q: string } } };
    assert.equal(`${body.result.result.p}/${body.result.result.q}`, "355/113");

    const steps = await (await fetch(`${base}/api/history/${body.id}/steps`)).json() as { steps: unknown[]; candidates: unknown[] };
    assert.ok(steps.steps.length > 0);
    assert.ok(steps.candidates.length > 0);

    const hist = await (await fetch(`${base}/api/history`)).json() as { records: unknown[] };
    assert.equal(hist.records.length, 1);

    const exp = await fetch(`${base}/api/export`);
    assert.equal(exp.status, 200);
    assert.ok((await exp.text()).includes("355"));

    const bad = await fetch(`${base}/api/approx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "1e5", maxDenominator: "10" }),
    });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "SCIENTIFIC_NOTATION");

    const cmp = await (await fetch(`${base}/api/approx/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "3.141592653589793", limits: ["10", "113"], save: false }),
    })).json() as { comparisons: { result: { p: string; q: string } }[] };
    assert.equal(`${cmp.comparisons[0].result.p}/${cmp.comparisons[0].result.q}`, "22/7");
    assert.equal(`${cmp.comparisons[1].result.p}/${cmp.comparisons[1].result.q}`, "355/113");
  } finally {
    server.close();
  }
});
