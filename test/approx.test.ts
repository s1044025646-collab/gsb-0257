import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInput, parseMaxDenominator, InputError } from "../src/parse.js";
import { approximate } from "../src/approx.js";
import { Rational, makeRational, absDiff, cmpRational } from "../src/rational.js";

const PI = "3.141592653589793";

function approx(raw: string, d: string | number) {
  return approximate(parseInput(raw), parseMaxDenominator(d), raw);
}

test("解析：整数、小数、分数、带分数、负数", () => {
  assert.deepEqual(parseInput("42"), { p: 42n, q: 1n });
  assert.deepEqual(parseInput("-0.5"), { p: -1n, q: 2n });
  assert.deepEqual(parseInput("3.1400"), { p: 157n, q: 50n });
  assert.deepEqual(parseInput("22/7"), { p: 22n, q: 7n });
  assert.deepEqual(parseInput("6/8"), { p: 3n, q: 4n }); // 自动约分
  assert.deepEqual(parseInput("3 1/2"), { p: 7n, q: 2n });
  assert.deepEqual(parseInput("-3 1/2"), { p: -7n, q: 2n });
  assert.deepEqual(parseInput(".25"), { p: 1n, q: 4n });
});

test("解析：拒绝非法输入", () => {
  for (const [input, code] of [
    ["1/0", "ZERO_DENOMINATOR"],
    ["1e5", "SCIENTIFIC_NOTATION"],
    ["abc", "BAD_FORMAT"],
    ["", "EMPTY_INPUT"],
    ["1.2.3", "BAD_FORMAT"],
  ] as const) {
    assert.throws(() => parseInput(input), (e: unknown) => (e as InputError).code === code);
  }
  assert.throws(() => parseMaxDenominator("0"), /D 必须/);
  assert.throws(() => parseMaxDenominator("-3"), /正整数/);
  assert.throws(() => parseMaxDenominator("1e13"), /正整数/);
});

test("演示：pi 在 D=10 与 D=113", () => {
  const r10 = approx(PI, 10);
  assert.equal(`${r10.result.p}/${r10.result.q}`, "22/7");
  const r113 = approx(PI, 113);
  assert.equal(`${r113.result.p}/${r113.result.q}`, "355/113");
});

test("演示：0.5 在 D=1 时平局取 0/1", () => {
  const r = approx("0.5", 1);
  assert.equal(`${r.result.p}/${r.result.q}`, "0/1");
  assert.equal(r.error.p, "1");
  assert.equal(r.error.q, "2");
});

test("演示：可精确表示的输入误差为零", () => {
  for (const [input, d] of [["22/7", 7], ["3.14", 100], ["-5", 1], ["0", 1], ["6/8", 4]] as const) {
    const r = approx(input, d);
    assert.equal(r.exact, true, input);
    assert.equal(r.error.p, "0");
    assert.equal(`${r.result.p}/${r.result.q}`, `${parseInput(input).p}/${parseInput(input).q}`);
  }
});

test("负数：-pi 在 D=113 得到 -355/113", () => {
  const r = approx(`-${PI}`, 113);
  assert.equal(`${r.result.p}/${r.result.q}`, "-355/113");
});

test("上限恰好命中：355/113 在 D=113 精确返回", () => {
  const r = approx("355/113", 113);
  assert.equal(r.exact, true);
  assert.equal(`${r.result.p}/${r.result.q}`, "355/113");
});

test("需要中间候选的例子：0.15 在 D=10 得到 1/7", () => {
  // 收敛分数为 0/1, 1/6, 1/7(超)；最优是中间候选 1/7? q=7<=10，其实 1/7 是收敛分数
  const r = approx("0.15", 10);
  assert.equal(`${r.result.p}/${r.result.q}`, "1/7");
});

test("中间候选胜出：13/30 在 D=4 得到 1/2 还是 0/1 需精确比较", () => {
  // 0.4333... 收敛: 0/1, 1/2, 3/7... D=4: 收敛 1/2 误差 1/15；中间 t=(4-0)/2=2 -> 1/2 同
  const r = approx("13/30", 4);
  assert.equal(`${r.result.p}/${r.result.q}`, "1/2");
});

test("中间候选真正必要的例子", () => {
  // x = 0.7 = 7/10，D=8：收敛 0/1, 1/1, 2/3, 7/10；D=8 时最后收敛 2/3，
  // 中间 t=(8-1)/3=2 -> (2*2+1)/(2*3+1)=5/7，|0.7-5/7|=1/70 < 1/30
  const r = approx("0.7", 8);
  assert.equal(`${r.result.p}/${r.result.q}`, "5/7");
});

test("大整数与大分母", () => {
  const r = approx("123456789012345678901234567890", 1000000);
  assert.equal(r.exact, true);
  const r2 = approx("0.123456789012345678901234567890123456789", 999999999999);
  assert.ok(BigInt(r2.result.q) <= 999999999999n);
});

/** 独立枚举校验：对小 D 枚举所有分母与输入附近的两个分子。 */
function bruteForce(x: Rational, D: bigint): Rational {
  let best: Rational | null = null;
  let bestErr: Rational | null = null;
  for (let q = 1n; q <= D; q++) {
    const prod = x.p * q; // x.p/x.q * q
    const base = prod / x.q;
    for (const p of [base - 1n, base, base + 1n, base + 2n]) {
      const c = makeRational(p, q);
      const e = absDiff(x, c);
      if (best === null) { best = c; bestErr = e; continue; }
      const cmp = cmpRational(e, bestErr!);
      if (cmp < 0 ||
        (cmp === 0 && (c.q < best.q ||
          (c.q === best.q && (c.p < 0n ? -c.p : c.p) < (best.p < 0n ? -best.p : best.p))))) {
        best = c; bestErr = e;
      }
    }
  }
  return best!;
}

test("独立枚举核对：误差最小性与平局选择", () => {
  const cases = ["3.141592653589793", "0.5", "0.7", "-2.71828", "13/30", "0.14159", "1.41421", "-0.333"];
  for (const input of cases) {
    for (let d = 1; d <= 60; d++) {
      const x = parseInput(input);
      const r = approximate(x, BigInt(d), input);
      const expected = bruteForce(x, BigInt(d));
      assert.equal(`${r.result.p}/${r.result.q}`, `${expected.p}/${expected.q}`, `${input} D=${d}`);
    }
  }
});

test("D 增加时最优误差不增加，输出已约分且分母合规", () => {
  const x = parseInput(PI);
  let prevErr: Rational | null = null;
  for (let d = 1; d <= 200; d++) {
    const r = approximate(x, BigInt(d), PI);
    const q = BigInt(r.result.q);
    assert.ok(q >= 1n && q <= BigInt(d));
    const g = makeRational(BigInt(r.result.p), q);
    assert.equal(g.p.toString(), r.result.p); // 已约分
    const err: Rational = { p: BigInt(r.error.p), q: BigInt(r.error.q) };
    if (prevErr) assert.ok(cmpRational(err, prevErr) <= 0, `D=${d} 误差上升`);
    prevErr = err;
  }
});

test("零与有限连分数终止点", () => {
  const z = approx("0", 5);
  assert.equal(`${z.result.p}/${z.result.q}`, "0/1");
  assert.equal(z.exact, true);
  const t = approx("2.5", 2);
  assert.equal(`${t.result.p}/${t.result.q}`, "5/2");
  assert.equal(t.exact, true);
});
