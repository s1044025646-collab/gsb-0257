import {
  Rational,
  makeRational,
  absError,
  compareCandidates,
  cmpRational,
} from './rational.js';

export interface CFStep {
  // 第几步（从 0 开始）
  index: number;
  // 该步部分商 a_i（有限连分数的终止项）
  partialQuotient: string;
  // 该步收敛分数分子/分母
  convergentNum: string;
  convergentDen: string;
  // 截至本步的连分数写法，例如 [3; 7, 15]
  notation: string;
  // 该收敛分数相对目标的绝对误差（分数）
  error: { num: string; den: string };
}

export interface Candidate {
  num: string;
  den: string;
  kind: 'convergent' | 'intermediate';
  step: number;
  error: { num: string; den: string };
}

export interface ApproxResult {
  input: Rational;
  maxDenominator: bigint;
  bestNum: bigint;
  bestDen: bigint;
  exactError: Rational;
  exact: boolean;
  steps: CFStep[];
  candidates: Candidate[];
}

interface Convergent {
  p: bigint;
  q: bigint;
}

// 对非负有理数求有限简单连分数部分商（标准欧几里得展开）。
// 返回 [a0, a1, ..., an]。
export function continuedFraction(x: Rational): bigint[] {
  if (x.num < 0n) throw new Error('continuedFraction 仅接受非负数');
  let num = x.num;
  let den = x.den;
  const terms: bigint[] = [];
  // 标准终止：当余数为 0 结束。
  while (true) {
    const a = num / den;
    terms.push(a);
    let r = num % den;
    if (r === 0n) break;
    num = den;
    den = r;
  }
  return terms;
}

// 由部分商递推所有收敛分数。
// p_-2=0,p_-1=1 ; q_-2=1,q_-1=0
function convergents(terms: bigint[]): Convergent[] {
  let pPrev2 = 0n, pPrev1 = 1n;
  let qPrev2 = 1n, qPrev1 = 0n;
  const out: Convergent[] = [];
  for (const a of terms) {
    const p = a * pPrev1 + pPrev2;
    const q = a * qPrev1 + qPrev2;
    out.push({ p, q });
    pPrev2 = pPrev1; pPrev1 = p;
    qPrev2 = qPrev1; qPrev1 = q;
  }
  return out;
}

function notation(terms: bigint[], upTo: number): string {
  if (upTo === 0) return `[${terms[0]}]`;
  return `[${terms[0]}; ${terms.slice(1, upTo + 1).join(', ')}]`;
}

// 在分母上限 D（正整数）下求最优约分分数。
// 算法：
//  1) 对 |x| 做连分数展开，生成全部收敛分数；
//  2) 凡 q<=D 的收敛分数纳入候选；
//  3) 当某个收敛分数 q_{n+1}>D 而 q_n<=D 时，加入上限处的中间分数
//     (k*p_n+p_{n-1})/(k*q_n+q_{n-1})，k 取使分母不超过 D 的最大值。
//     中间分数误差随 k 单调下降，故只需检验最大可行 k。
//  全程整数交叉相乘比较误差。负数先对绝对值求解再翻号。
export function bestApproximation(input: Rational, D: bigint): ApproxResult {
  const negative = input.num < 0n;
  const target = negative ? { num: -input.num, den: input.den } : input;

  const terms = continuedFraction(target);
  const convs = convergents(terms);

  const steps: CFStep[] = [];
  const candidates: Candidate[] = [];

  let bestP = 0n;
  let bestQ = 1n;
  let bestE = absError(target, bestP, bestQ);

  const consider = (p: bigint, q: bigint, kind: Candidate['kind'], step: number) => {
    const e = absError(target, p, q);
    candidates.push({
      num: p.toString(),
      den: q.toString(),
      kind,
      step,
      error: { num: e.num.toString(), den: e.den.toString() },
    });
    if (compareCandidates(e, p, q, bestE, bestP, bestQ) < 0) {
      bestP = p; bestQ = q; bestE = e;
    }
  };

  // 初始候选 0/1（对 0<=x<1 的情形重要），作为稳定基线。
  // 它也等于边界退化中间分数 k=0 的情形，统一显式纳入。
  consider(0n, 1n, 'intermediate', -1);

  for (let i = 0; i < convs.length; i++) {
    const { p, q } = convs[i];
    const e = absError(target, p, q);
    steps.push({
      index: i,
      partialQuotient: terms[i].toString(),
      convergentNum: p.toString(),
      convergentDen: q.toString(),
      notation: notation(terms, i),
      error: { num: e.num.toString(), den: e.den.toString() },
    });

    if (q <= D) {
      consider(p, q, 'convergent', i);
    } else {
      // 首次越界：加入上限中间分数（基于上一个合规收敛分数）。
      if (i >= 1) {
        const prev = convs[i - 1];
        const pPrev = i >= 2 ? convs[i - 2].p : 1n;
        const qPrev = i >= 2 ? convs[i - 2].q : 0n;
        // (k*q_prev1 + q_prev2) <= D
        const denomBase = prev.q;
        const denomConst = qPrev;
        if (denomBase > 0n) {
          const k = (D - denomConst) / denomBase;
          if (k >= 0n) {
            const mp = k * prev.p + pPrev;
            const mq = k * prev.q + qPrev;
            if (mq >= 1n && mq <= D) {
              consider(mp, mq, 'intermediate', i);
            }
          }
        }
      }
      break; // 后续收敛分母严格增大，无需再看
    }
  }

  // 处理目标本身可被精确表示且其分母 > D 时不会发生；
  // 若最后一个收敛（=目标，误差0）在限内，bestE 已为 0。

  // 翻号回负数。
  let finalP = bestP;
  if (negative) {
    finalP = -bestP;
    bestE = absError(input, finalP, bestQ);
  }

  const reduced = makeRational(finalP, bestQ);
  const exactError = absError(input, reduced.num, reduced.den);
  const exact = cmpRational(exactError, { num: 0n, den: 1n }) === 0;

  return {
    input,
    maxDenominator: D,
    bestNum: reduced.num,
    bestDen: reduced.den,
    exactError,
    exact,
    steps: negative
      ? steps // 步骤按 |x| 展示；调用方可据输入符号理解
      : steps,
    candidates,
  };
}

// 暴力枚举：对每个 q in 1..D，取四舍五入最近的两个分子 floor/ceil，交叉相乘比误差。
// 仅用于测试核对（D 小时）。
export function bruteForceBest(input: Rational, D: bigint): { num: bigint; den: bigint } {
  let bestP = 0n, bestQ = 1n, bestE = absError(input, 0n, 1n);
  for (let q = 1n; q <= D; q++) {
    const exactNumTimesQ = (input.num * q) / input.den;
    for (const p of [exactNumTimesQ, exactNumTimesQ + 1n, exactNumTimesQ - 1n]) {
      const e = absError(input, p, q);
      if (compareCandidates(e, p, q, bestE, bestP, bestQ) < 0) {
        bestP = p; bestQ = q; bestE = e;
      }
    }
  }
  return makeRational(bestP, bestQ);
}
