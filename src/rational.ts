/** 精确有理数：全部使用 BigInt，永不经过浮点。 */
export interface Rational {
  /** 分子（可负） */
  p: bigint;
  /** 分母（恒为正整数） */
  q: bigint;
}

export function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** 构造已约分、分母为正的有理数。分母为零时抛错。 */
export function makeRational(p: bigint, q: bigint): Rational {
  if (q === 0n) throw new Error("ZERO_DENOMINATOR");
  if (q < 0n) { p = -p; q = -q; }
  const g = gcd(p, q);
  return { p: p / g, q: q / g };
}

export function absDiff(a: Rational, b: Rational): Rational {
  const num = a.p * b.q - b.p * a.q;
  const n = num < 0n ? -num : num;
  return makeRational(n, a.q * b.q);
}

/** 比较有理数大小：a<b 返回 -1，相等 0，a>b 返回 1。 */
export function cmpRational(a: Rational, b: Rational): number {
  const lhs = a.p * b.q;
  const rhs = b.p * a.q;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

/** 仅用于展示的小数展开（不影响任何判断）。 */
export function toDecimal(r: Rational, digits = 12): string {
  const neg = r.p < 0n;
  let num = neg ? -r.p : r.p;
  const intPart = num / r.q;
  let rem = num % r.q;
  if (rem === 0n) return (neg ? "-" : "") + intPart.toString();
  let frac = "";
  for (let i = 0; i < digits && rem !== 0n; i++) {
    rem *= 10n;
    frac += (rem / r.q).toString();
    rem %= r.q;
  }
  const suffix = rem !== 0n ? "…" : "";
  return `${neg ? "-" : ""}${intPart}.${frac}${suffix}`;
}
