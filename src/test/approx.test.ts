import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRational, makeRational, absError, cmpRational, InputError } from '../rational.js';
import { bestApproximation, bruteForceBest, continuedFraction } from '../approx.js';
import { buildReport, parseD } from '../service.js';

function approx(input: string, D: bigint) {
  const r = bestApproximation(parseRational(input), D);
  return { p: r.bestNum, q: r.bestDen, exact: r.exact, err: r.exactError };
}

test('演示: pi D=10 -> 22/7', () => {
  const r = approx('3.141592653589793', 10n);
  assert.equal(r.p, 22n);
  assert.equal(r.q, 7n);
});

test('演示: pi D=113 -> 355/113', () => {
  const r = approx('3.141592653589793', 113n);
  assert.equal(r.p, 355n);
  assert.equal(r.q, 113n);
});

test('演示: 0.5 D=1 平局取较小分母再较小分子 -> 0/1', () => {
  const r = approx('0.5', 1n);
  assert.equal(r.p, 0n);
  assert.equal(r.q, 1n);
  // 0/1 与 1/1 误差均为 1/2，平局选分母小（同为1）再分子小 0
  assert.equal(r.err.num, 1n);
  assert.equal(r.err.den, 2n);
});

test('已能精确表示 -> 误差为零', () => {
  const r = approx('3/4', 10n);
  assert.equal(r.p, 3n);
  assert.equal(r.q, 4n);
  assert.equal(r.exact, true);
  assert.equal(r.err.num, 0n);
});

test('整数与约分输入直接返回', () => {
  assert.deepEqual(approx('7', 3n), { p: 7n, q: 1n, exact: true, err: makeRational(0n, 1n) });
  assert.deepEqual(approx('6/4', 10n).p, 3n);
  assert.deepEqual(approx('6/4', 10n).q, 2n);
});

test('零', () => {
  const r = approx('0', 5n);
  assert.equal(r.p, 0n);
  assert.equal(r.q, 1n);
  assert.equal(r.exact, true);
});

test('负数: -pi D=10 -> -22/7', () => {
  const r = approx('-3.141592653589793', 10n);
  assert.equal(r.p, -22n);
  assert.equal(r.q, 7n);
});

test('负分数 -2/3 小 D', () => {
  const r = approx('-2/3', 2n);
  // 枚举: -1/1 误差1/3, -1/2误差1/6(更近? |-2/3+1/2|=1/6), 0/1=2/3
  assert.equal(r.p, -1n);
  assert.equal(r.q, 2n);
});

test('带整数部分 1 1/2 = 3/2', () => {
  const v = parseRational('1 1/2');
  assert.equal(v.num, 3n);
  assert.equal(v.den, 2n);
});

test('负带分数 -1 1/2', () => {
  const v = parseRational('-1 1/2');
  assert.equal(v.num, -3n);
});

test('上限恰好命中: pi D=7 -> 22/7', () => {
  const r = approx('3.141592653589793', 7n);
  assert.equal(r.p, 22n);
  assert.equal(r.q, 7n);
});

test('需要中间候选: 5/12 之类', () => {
  // 4/7 ≈ 0.5714。D=3 时收敛分数可能越界，需要中间分数。
  const target = '4/7';
  const r = approx(target, 3n);
  const bf = bruteForceBest(parseRational(target), 3n);
  assert.equal(r.p, bf.num);
  assert.equal(r.q, bf.den);
});

test('需要中间候选: sqrt2 近似 1.4142 D=5 -> 7/5', () => {
  const r = approx('1.41421356', 5n);
  const bf = bruteForceBest(parseRational('1.41421356'), 5n);
  assert.equal(r.p, bf.num);
  assert.equal(r.q, bf.den);
  assert.equal(r.p, 7n);
  assert.equal(r.q, 5n);
});

test('大整数精确处理（不转浮点）', () => {
  const r = approx('123456789012345678901/100000000000000000000', 100n);
  const bf = bruteForceBest(parseRational('123456789012345678901/100000000000000000000'), 100n);
  assert.equal(r.p, bf.num);
  assert.equal(r.q, bf.den);
});

test('对一批输入与较小 D 与暴力枚举完全一致（含平局规则）', () => {
  const inputs = [
    '0', '1', '-1', '0.3', '-0.3', '2/5', '-7/9', '1 3/8', '-2 1/4',
    '3.14159', '0.001', '0.999', '5/12', '11/13', '-17/23', '1.61803398',
  ];
  for (const input of inputs) {
    for (let d = 1n; d <= 30n; d++) {
      const x = parseRational(input);
      const got = bestApproximation(x, d);
      const bf = bruteForceBest(x, d);
      assert.ok(
        got.bestNum === bf.num && got.bestDen === bf.den,
        `${input} D=${d}: got ${got.bestNum}/${got.bestDen}, brute ${bf.num}/${bf.den}`
      );
      // 输出已约分且分母合规
      assert.ok(got.bestDen >= 1n && got.bestDen <= d);
      const e = absError(x, got.bestNum, got.bestDen);
      assert.equal(cmpRational(e, got.exactError), 0);
    }
  }
});

test('D 增加时最优误差不增加', () => {
  const x = parseRational('3.141592653589793');
  let prev = null as null | { num: bigint; den: bigint };
  for (let d = 1n; d <= 200n; d++) {
    const e = bestApproximation(x, d).exactError;
    if (prev) assert.ok(cmpRational(e, prev) <= 0, `D=${d} 误差增大`);
    prev = e;
  }
});

test('连分数终止点: 有理数有限展开', () => {
  const terms = continuedFraction(parseRational('355/113'));
  assert.deepEqual(terms.map(String), ['3', '7', '16']);
});

test('解析拒绝: 零分母 / 非数字 / 科学计数法 / 超限', () => {
  assert.throws(() => parseRational('1/0'), (e: Error) => (e as InputError).code === 'ZERO_DENOMINATOR');
  assert.throws(() => parseRational('abc'), (e: Error) => (e as InputError).code === 'NOT_A_NUMBER');
  assert.throws(() => parseRational('1e3'), (e: Error) => (e as InputError).code === 'SCIENTIFIC_NOTATION');
  assert.throws(() => parseD('0'), (e: Error) => (e as InputError).code === 'D_NOT_POSITIVE');
  assert.throws(() => parseD('1.5'), (e: Error) => (e as InputError).code === 'D_NOT_INTEGER');
});

test('拒绝直接传 number 以防浮点', () => {
  assert.throws(() => parseRational(3.14), (e: Error) => (e as InputError).code === 'FLOAT_INPUT_FORBIDDEN');
});

test('报告含小数展示、依据、候选与步骤', () => {
  const rep = buildReport('3.141592653589793', 10n);
  assert.equal(rep.bestFraction, '22/7');
  assert.ok(rep.exactErrorFraction.includes('/'));
  assert.ok(rep.continuedFraction.steps.length > 0);
  assert.ok(rep.candidates.length > 0);
  assert.ok(rep.selectionBasis.length > 0);
});
