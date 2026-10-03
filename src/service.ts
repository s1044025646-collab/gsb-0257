import {
  parseRational,
  makeRational,
  InputError,
  MAX_D,
  MAX_INPUT_DIGITS,
  Rational,
} from './rational.js';
import { bestApproximation, ApproxResult } from './approx.js';
import { toDecimal, displayFraction } from './decimal.js';

export const INPUT_VERSION = 'frac-approx/input/v1';

export function parseD(raw: unknown): bigint {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) {
      throw new InputError('D_NOT_INTEGER', '最大分母 D 必须是正整数');
    }
    raw = String(raw);
  }
  const s = String(raw ?? '').trim();
  if (!/^[0-9]+$/.test(s)) {
    throw new InputError('D_NOT_INTEGER', '最大分母 D 必须是正整数');
  }
  const d = BigInt(s);
  if (d < 1n) throw new InputError('D_NOT_POSITIVE', '最大分母 D 必须 >= 1');
  if (d > MAX_D) throw new InputError('D_TOO_LARGE', `最大分母 D 超过上限 ${MAX_D}`);
  return d;
}

export interface Report {
  input: string;
  inputVersion: string;
  inputValueFraction: string;
  inputDecimal: string;
  maxDenominator: number;
  bestFraction: string;
  bestNum: string;
  bestDen: string;
  bestDecimal: string;
  exactErrorFraction: string;
  exactError: { num: string; den: string };
  exactErrorDecimal: string;
  exact: boolean;
  selectionBasis: string;
  continuedFraction: {
    finite: boolean;
    terms: string[];
    steps: ApproxResult['steps'];
  };
  candidates: ApproxResult['candidates'];
}

export function buildReport(inputStr: string, D: bigint): Report {
  const x = parseRational(inputStr);
  const res = bestApproximation(x, D);
  return formatResult(inputStr, D, x, res);
}

function formatResult(inputStr: string, D: bigint, x: Rational, res: ApproxResult): Report {
  // 连分数部分商按 |x| 的展开给出（负数仅整体翻号，部分商不变）。
  const terms = res.steps.map((s) => s.partialQuotient);

  const basis = res.exact
    ? '输入本身已为约分分数且分母在限制内，误差为 0，直接返回原值。'
    : '在所有分母 1..D 的可行分数中，经连分数收敛分数与上限处中间候选比较，' +
      '以整数交叉相乘精确比较绝对误差选取最小者；平局先取较小分母，再取较小分子。';

  return {
    input: inputStr,
    inputVersion: INPUT_VERSION,
    inputValueFraction: displayFraction(x.num, x.den),
    inputDecimal: toDecimal(x, 18),
    maxDenominator: Number(D),
    bestFraction: displayFraction(res.bestNum, res.bestDen),
    bestNum: res.bestNum.toString(),
    bestDen: res.bestDen.toString(),
    bestDecimal: toDecimal(makeRational(res.bestNum, res.bestDen), 18),
    exactErrorFraction: displayFraction(res.exactError.num, res.exactError.den),
    exactError: { num: res.exactError.num.toString(), den: res.exactError.den.toString() },
    exactErrorDecimal: toDecimal(res.exactError, 18),
    exact: res.exact,
    selectionBasis: basis,
    continuedFraction: {
      finite: true, // 有理数的连分数恒有限
      terms,
      steps: res.steps,
    },
    candidates: res.candidates,
  };
}

// 上限对照：对多个 D 分别计算（各自独立快照）。
export function compareLimits(
  inputStr: string,
  Ds: bigint[]
): { input: string; results: { maxDenominator: number; report: Report }[] } {
  return {
    input: inputStr,
    results: Ds.map((d) => ({ maxDenominator: Number(d), report: buildReport(inputStr, d) })),
  };
}

export { MAX_D, MAX_INPUT_DIGITS };
