import { Rational } from './rational.js';

// 仅用于展示的有限小数；除不尽时截断到 digits 位并标注。
export function toDecimal(x: Rational, digits = 12): string {
  const neg = x.num < 0n;
  let num = neg ? -x.num : x.num;
  const den = x.den;
  const intPart = num / den;
  let rem = num % den;
  let frac = '';
  let truncated = false;
  for (let i = 0; i < digits; i++) {
    if (rem === 0n) break;
    rem *= 10n;
    frac += (rem / den).toString();
    rem %= den;
    if (i === digits - 1 && rem !== 0n) truncated = true;
  }
  let out = (neg ? '-' : '') + intPart.toString();
  if (frac !== '') out += '.' + frac;
  if (truncated) out += '…';
  return out;
}

export function displayFraction(num: bigint, den: bigint): string {
  if (den === 1n) return num.toString();
  return `${num}/${den}`;
}
