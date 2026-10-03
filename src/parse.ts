import { Rational, makeRational } from "./rational.js";

export const MAX_DENOMINATOR = 1_000_000_000_000n; // 10^12
export const MAX_INPUT_DIGITS = 1000;

export class InputError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "InputError";
  }
}

function countDigits(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}

function checkDigits(s: string): void {
  if (countDigits(s) > MAX_INPUT_DIGITS) {
    throw new InputError("INPUT_TOO_LONG", `输入位数超过上限 ${MAX_INPUT_DIGITS}`);
  }
}

/**
 * 解析输入为精确有理数。支持：
 *  - 整数："-42"
 *  - 有限十进制："3.14"、"-0.5"、".25"（拒绝科学计数法）
 *  - 分数："22/7"、"-355/113"
 *  - 带整数部分分数："3 1/2"、"-3 1/2"（负号作用于整体）
 */
export function parseInput(raw: string): Rational {
  if (typeof raw !== "string") throw new InputError("BAD_TYPE", "输入必须是字符串");
  const s = raw.trim();
  if (s === "") throw new InputError("EMPTY_INPUT", "输入为空");
  if (/[eE]/.test(s)) throw new InputError("SCIENTIFIC_NOTATION", "不支持科学计数法");
  checkDigits(s);

  const mixed = /^([+-]?)(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) {
    const [, sign, w, n, d] = mixed;
    const den = BigInt(d);
    if (den === 0n) throw new InputError("ZERO_DENOMINATOR", "分母不能为零");
    const val = makeRational(BigInt(w) * den + BigInt(n), den);
    return sign === "-" ? { p: -val.p, q: val.q } : val;
  }

  const frac = /^([+-]?\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const den = BigInt(frac[2]);
    if (den === 0n) throw new InputError("ZERO_DENOMINATOR", "分母不能为零");
    return makeRational(BigInt(frac[1]), den);
  }

  const dec = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(s);
  if (dec && (dec[2] !== "" || dec[3] !== undefined)) {
    const [, sign, intPart, fracPart] = dec;
    const digits = (intPart || "") + (fracPart || "");
    if (digits === "") throw new InputError("BAD_FORMAT", "无法解析的输入格式");
    const scale = 10n ** BigInt((fracPart || "").length);
    const val = makeRational(BigInt(digits), scale);
    return sign === "-" ? { p: -val.p, q: val.q } : val;
  }

  throw new InputError("BAD_FORMAT", `无法解析的输入格式: ${s}`);
}

/** 解析并校验最大分母 D：必须是 1..MAX_DENOMINATOR 的正整数。 */
export function parseMaxDenominator(raw: string | number | bigint): bigint {
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) throw new InputError("BAD_DENOMINATOR_LIMIT", "D 必须是正整数");
  const d = BigInt(s);
  if (d < 1n) throw new InputError("BAD_DENOMINATOR_LIMIT", "D 必须 >= 1");
  if (d > MAX_DENOMINATOR) {
    throw new InputError("DENOMINATOR_LIMIT_TOO_LARGE", `D 超过上限 ${MAX_DENOMINATOR}`);
  }
  return d;
}
