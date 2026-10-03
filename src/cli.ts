#!/usr/bin/env node
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { openDb, insertCalculation, getCalculation, listCalculations } from './store.js';
import { buildReport, compareLimits, parseD, INPUT_VERSION } from './service.js';
import { InputError } from './rational.js';
import { SnapshotPayload } from './store.js';

const dbPath = process.env.FRAC_DB_PATH ?? resolve('data/frac.db');

function printReport(r: ReturnType<typeof buildReport>) {
  console.log(`输入         : ${r.input}  (= ${r.inputValueFraction} ≈ ${r.inputDecimal})`);
  console.log(`最大分母 D   : ${r.maxDenominator}`);
  console.log(`最优分数     : ${r.bestFraction}  (≈ ${r.bestDecimal})`);
  console.log(`精确绝对误差 : ${r.exactErrorFraction}  (≈ ${r.exactErrorDecimal})${r.exact ? '  [精确相等]' : ''}`);
  console.log(`选择依据     : ${r.selectionBasis}`);
  console.log(`连分数       : 有限=${r.continuedFraction.finite} 项=[${r.continuedFraction.terms.join(', ')}]`);
  for (const s of r.continuedFraction.steps) {
    console.log(
      `   #${s.index} ${s.notation} -> ${s.convergentNum}/${s.convergentDen} ` +
      `误差 ${s.error.num}/${s.error.den}`
    );
  }
  console.log('候选误差:');
  for (const c of r.candidates) {
    console.log(`   [${c.kind}] ${c.num}/${c.den} 误差 ${c.error.num}/${c.error.den}`);
  }
}

function store(r: ReturnType<typeof buildReport>, input: string, D: bigint): number {
  const db = openDb(dbPath);
  const snapshot: SnapshotPayload = {
    input,
    inputValue: r.inputValueFraction,
    maxDenominator: r.maxDenominator,
    inputVersion: r.inputVersion,
    result: r,
  };
  return insertCalculation(db, {
    input,
    inputValue: r.inputValueFraction,
    maxDenominator: Number(D),
    inputVersion: r.inputVersion,
    snapshot,
  });
}

function usage() {
  console.log(`frac-approx — 有限分母分数近似 / 连分数解释

用法:
  frac-approx calc <input> <D>            单条计算（写入数据库）
  frac-approx batch <input:D,input:D,...> 批量计算
  frac-approx compare <input> <D1,D2,...> 上限对照
  frac-approx steps <input> <D>           查看连分数步骤与候选
  frac-approx history [limit]             查看历史
  frac-approx get <id>                    查看某条历史完整解释
  frac-approx export <out.csv>            导出历史为 CSV

环境变量:
  PORT            HTTP 端口（server 使用，默认空闲端口）
  FRAC_DB_PATH    SQLite 文件路径（默认 data/frac.db）

输入版本: ${INPUT_VERSION}`);
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'calc':
      case 'steps': {
        const [input, dStr] = args;
        if (input === undefined || dStr === undefined) throw new InputError('USAGE', '需要 <input> <D>');
        const D = parseD(dStr);
        const r = buildReport(input, D);
        const id = store(r, input, D);
        console.log(`算例 #${id}`);
        printReport(r);
        break;
      }
      case 'batch': {
        const [spec] = args;
        if (!spec) throw new InputError('USAGE', '需要 input:D,input:D,...');
        const items = spec.split(',').map((s) => s.trim()).filter(Boolean);
        items.forEach((item, index) => {
          const at = item.lastIndexOf(':');
          try {
            if (at === -1) throw new InputError('USAGE', '条目需为 input:D');
            const input = item.slice(0, at);
            const D = parseD(item.slice(at + 1));
            const r = buildReport(input, D);
            const id = store(r, input, D);
            console.log(`[#${index}] OK id=${id} ${r.input} D=${r.maxDenominator} -> ${r.bestFraction} 误差 ${r.exactErrorFraction}`);
          } catch (err: any) {
            console.log(`[#${index}] FAIL ${err.code ?? 'ERROR'}: ${err.message}`);
          }
        });
        break;
      }
      case 'compare': {
        const [input, dList] = args;
        if (input === undefined || dList === undefined) throw new InputError('USAGE', '需要 <input> <D1,D2,...>');
        const Ds = dList.split(',').map((d) => parseD(d));
        const cmp = compareLimits(input, Ds);
        for (const { maxDenominator, report } of cmp.results) {
          console.log(`D=${maxDenominator} -> ${report.bestFraction} 误差 ${report.exactErrorFraction}`);
        }
        break;
      }
      case 'history': {
        const limit = args[0] ? Number(args[0]) : 20;
        const db = openDb(dbPath);
        const rows = listCalculations(db, { limit });
        for (const r of rows) {
          const rep = JSON.parse(r.snapshot).result;
          console.log(`#${r.id} [${r.created_at}] ${r.input} D=${r.max_denominator} -> ${rep.bestFraction} 误差 ${rep.exactErrorFraction}`);
        }
        console.log(`共 ${rows.length} 条`);
        break;
      }
      case 'get': {
        const id = Number(args[0]);
        if (!Number.isInteger(id)) throw new InputError('USAGE', '需要数字 id');
        const db = openDb(dbPath);
        const row = getCalculation(db, id);
        if (!row) throw new InputError('NOT_FOUND', `未找到 #${id}`);
        console.log(JSON.stringify(JSON.parse(row.snapshot), null, 2));
        break;
      }
      case 'export': {
        const out = args[0] ?? 'calculations.csv';
        const db = openDb(dbPath);
        const rows = listCalculations(db, { limit: 500 });
        const lines = ['id,created_at,input,input_value,max_denominator,input_version,best,exact_error'];
        for (const r of rows) {
          const rep = JSON.parse(r.snapshot).result;
          lines.push([r.id, r.created_at, JSON.stringify(r.input), r.input_value, r.max_denominator,
            r.input_version, rep.bestFraction, rep.exactErrorFraction].join(','));
        }
        writeFileSync(out, '﻿' + lines.join('\n'), 'utf-8');
        console.log(`已导出 ${rows.length} 条到 ${out}`);
        break;
      }
      default:
        usage();
        if (cmd && cmd !== '-h' && cmd !== '--help') process.exitCode = 1;
    }
  } catch (err: any) {
    if (err instanceof InputError) {
      console.error(`错误 [${err.code}]: ${err.message}`);
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  }
}

main();
