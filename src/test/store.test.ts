import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openDb, insertCalculation, getCalculation, listCalculations } from '../store.js';
import { buildReport } from '../service.js';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'frac-'));
  return { db: openDb(join(dir, 't.db')), dir };
}

test('保存后可读取，且快照不随后续上限修改而改变', () => {
  const { db } = tempDb();
  const r10 = buildReport('3.141592653589793', 10n);
  const id = insertCalculation(db, {
    input: '3.141592653589793',
    inputValue: r10.inputValueFraction,
    maxDenominator: 10,
    inputVersion: r10.inputVersion,
    snapshot: {
      input: '3.141592653589793',
      inputValue: r10.inputValueFraction,
      maxDenominator: 10,
      inputVersion: r10.inputVersion,
      result: r10,
    },
  });

  // 之后用更大 D 再算一次（不覆盖旧记录）
  const r113 = buildReport('3.141592653589793', 113n);
  insertCalculation(db, {
    input: '3.141592653589793',
    inputValue: r113.inputValueFraction,
    maxDenominator: 113,
    inputVersion: r113.inputVersion,
    snapshot: {
      input: '3.141592653589793',
      inputValue: r113.inputValueFraction,
      maxDenominator: 113,
      inputVersion: r113.inputVersion,
      result: r113,
    },
  });

  const old = getCalculation(db, id)!;
  const snap = JSON.parse(old.snapshot);
  assert.equal(snap.result.bestFraction, '22/7');
  assert.equal(snap.maxDenominator, 10);
  assert.equal(snap.inputVersion, r10.inputVersion);

  const rows = listCalculations(db, {});
  assert.equal(rows.length, 2);
});

test('重启等价测试：关闭并以同一路径重新打开仍可读取', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frac-restart-'));
  const path = join(dir, 't.db');
  const db1 = openDb(path);
  const r = buildReport('1/3', 5n);
  const id = insertCalculation(db1, {
    input: '1/3',
    inputValue: r.inputValueFraction,
    maxDenominator: 5,
    inputVersion: r.inputVersion,
    snapshot: {
      input: '1/3', inputValue: r.inputValueFraction, maxDenominator: 5,
      inputVersion: r.inputVersion, result: r,
    },
  });
  db1.close();

  const db2 = openDb(path);
  const row = getCalculation(db2, id)!;
  assert.ok(row);
  assert.equal(JSON.parse(row.snapshot).result.bestFraction, '1/3');
  db2.close();
});
