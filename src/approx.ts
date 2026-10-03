import { Rational, makeRational, absDiff, cmpRational, toDecimal } from "./rational.js";

export interface CandidateInfo {
  p: string;
  q: string;
  kind: "convergent" | "intermediate" | "exact";
  error: string; // 精确误差分数
  errorDecimal: string;
}

export interface CfStep {
  index: number;
  partialQuotient: string;
  convergentP: string;
  convergentQ: string;
  error: string;
  errorDecimal: string;
  withinLimit: boolean;
}

export interface ApproxResult {
  input: { raw: string; p: string; q: string; decimal: string };
  maxDenominator: string;
  result: { p: string; q: string; decimal: string };
  error: { p: string; q: string; decimal: string };
  exact: boolean;
  reason: string;
  continuedFraction: string[];
  steps: CfStep[];
  candidates: CandidateInfo[];
}

const ZERO: Rational = { p: 0n, q: 1n };

function errOf(x: Rational, c: Rational): Rational {
  return absDiff(x, c);
}

/** 平局规则：误差小者优先；误差相同取较小分母；再相同取较小 |分子|；再相同取较小分子。 */
export function betterCandidate(a: Rational, ea: Rational, b: Rational, eb: Rational): Rational {
  const c = cmpRational(ea, eb);
  if (c !== 0) return c < 0 ? a : b;
  if (a.q !== b.q) return a.q < b.q ? a : b;
  const aa = a.p < 0n ? -a.p : a.p;
  const bb = b.p < 0n ? -b.p : b.p;
  if (aa !== bb) return aa < bb ? a : b;
  return a.p <= b.p ? a : b;
}

/**
 * 在分母 <= D 的分数中，求与 x 绝对误差最小的约分分数 p/q。
 * 方法：连分数展开 + 收敛分数 + 上限处的中间分数（半收敛），
 * 全部用 BigInt 交叉相乘精确比较，绝不经过浮点。
 */
export function approximate(x: Rational, D: bigint, raw: string): ApproxResult {
  const negative = x.p < 0n;
  const ax: Rational = negative ? { p: -x.p, q: x.q } : x;

  // 连分数展开（对 |x|），同时生成收敛分数
  const partials: bigint[] = [];
  const convs: Rational[] = [];
  {
    let n = ax.p, d = ax.q;
    let hm2 = 0n, hm1 = 1n, km2 = 1n, km1 = 0n; // h_{-2},h_{-1},k_{-2},k_{-1}
    while (d !== 0n) {
      const a = n / d;
      partials.push(a);
      const h = a * hm1 + hm2;
      const k = a * km1 + km2;
      convs.push({ p: h, q: k });
      hm2 = hm1; hm1 = h; km2 = km1; km1 = k;
      const r = n % d;
      n = d; d = r;
    }
  }

  const steps: CfStep[] = convs.map((c, i) => {
    const e = errOf(ax, c);
    return {
      index: i,
      partialQuotient: partials[i].toString(),
      convergentP: (negative ? -c.p : c.p).toString(),
      convergentQ: c.q.toString(),
      error: `${e.p}/${e.q}`,
      errorDecimal: toDecimal(e),
      withinLimit: c.q <= D,
    };
  });

  const candidates: CandidateInfo[] = [];
  const pushCand = (r: Rational, kind: CandidateInfo["kind"]) => {
    const e = errOf(ax, r);
    candidates.push({
      p: (negative ? -r.p : r.p).toString(),
      q: r.q.toString(),
      kind,
      error: `${e.p}/${e.q}`,
      errorDecimal: toDecimal(e),
    });
  };

  // 找到最后一个分母不超 D 的收敛分数
  let lastIdx = -1;
  for (let i = 0; i < convs.length; i++) {
    if (convs[i].q <= D) lastIdx = i; else break;
  }

  let best: Rational;
  let bestErr: Rational;
  let reason: string;
  let exact = false;

  const lastConvExact = lastIdx === convs.length - 1 && errOf(ax, convs[lastIdx]).p === 0n;

  if (lastConvExact) {
    // 输入在限制内可精确表示（含约分后分母已合规的情形）
    best = convs[lastIdx];
    bestErr = ZERO;
    exact = true;
    reason = "输入在分母上限内可精确表示，误差为零，直接返回约分后的原值";
    pushCand(best, "exact");
  } else {
    const conv = convs[lastIdx];
    const convErr = errOf(ax, conv);
    pushCand(conv, "convergent");

    // 上限处的中间（半收敛）候选：t = floor((D - k_{n-1}) / k_n)
    let semi: Rational | null = null;
    if (lastIdx + 1 < convs.length) {
      const prev = lastIdx >= 1 ? convs[lastIdx - 1] : { p: 1n, q: 0n };
      const t = (D - prev.q) / conv.q;
      if (t >= 1n) {
        semi = makeRational(t * conv.p + prev.p, t * conv.q + prev.q);
        pushCand(semi, "intermediate");
      }
    }
    best = conv;
    bestErr = convErr;
    if (semi !== null) {
      const semiErr = errOf(ax, semi);
      best = betterCandidate(best, bestErr, semi, semiErr);
      bestErr = errOf(ax, best);
    }
    reason = best === conv
      ? "最后一个未超限收敛分数在精确比较中优于上限处中间候选"
      : "上限处中间候选在精确比较中优于最后一个未超限收敛分数";
  }

  const signed: Rational = negative ? { p: -best.p, q: best.q } : best;
  const finalErr = errOf(x, signed);
  return {
    input: { raw, p: x.p.toString(), q: x.q.toString(), decimal: toDecimal(x) },
    maxDenominator: D.toString(),
    result: { p: signed.p.toString(), q: signed.q.toString(), decimal: toDecimal(signed) },
    error: { p: finalErr.p.toString(), q: finalErr.q.toString(), decimal: toDecimal(finalErr) },
    exact,
    reason,
    continuedFraction: partials.map((p) => p.toString()),
    steps,
    candidates,
  };
}
