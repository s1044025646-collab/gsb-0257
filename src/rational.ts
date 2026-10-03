// 精确有理数：全程 BigInt，绝不经过浮点。

export interface Rational {
  // 分母恒为正；分子可负；零表示为 0n/1n
  num: bigint;
  den: bigint;
}

// 公开的输入位数上限（整数与小数数字位合计，不含符号、小数点、斜杠、空格）。
export const MAX_INPUT_DIGITS = 200;
// 分母 D 上限，防止拒绝服务。
export const MAX_D = 1_000_000n;

export class InputError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'InputError';
    this.code = code;
  }
}

export function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function makeRational(num: bigint, den: bigint): Rational {
  if (den === 0n) throw new InputError('ZERO_DENOMINATOR', '分母不能为零');
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  if (num === 0n) return { num: 0n, den: 1n };
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

const isDigits = (s: string) => s.length > 0 && /^[0-9]+$/.test(s);

function countDigits(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= '0' && ch <= '9') n++;
  return n;
}

// 解析“一个纯数字部分”：整数或有限十进制（不接受科学计数法）。
function parseDecimalPart(raw: string): Rational {
  const s = raw.trim();
  if (s.includes('e') || s.includes('E')) {
    throw new InputError('SCIENTIFIC_NOTATION', '不支持科学计数法');
  }
  if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(s)) {
    throw new InputError('NOT_A_NUMBER', `无法解析为数字: "${raw}"`);
  }
  if (countDigits(s) > MAX_INPUT_DIGITS) {
    throw new InputError('INPUT_TOO_LARGE', `输入数字位数超过上限 ${MAX_INPUT_DIGITS}`);
  }
  const neg = s.startsWith('-');
  const body = s.replace(/^[+-]/, '');
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? '' : body.slice(dot + 1);
  const digits = (intPart || '0') + fracPart;
  const num = BigInt(digits) * (neg ? -1n : 1n);
  const den = 10n ** BigInt(fracPart.length);
  return makeRational(num, den);
}

// 支持的形态（可用空格分隔整数与真/假分数）：
//  3, -3, 3.14, .5, 2/3, -2/3, 1 1/2, -1 1/2, "3 3/7"
// 带整数部分 a b/c 解释为 a + b/c（b/c 的分子允许负号以校验一致）。
export function parseRational(input: string | number | bigint): Rational {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new InputError('NOT_A_NUMBER', '数字必须有限');
    }
    throw new InputError('FLOAT_INPUT_FORBIDDEN', '请以字符串提供输入，避免浮点误差');
  }
  if (typeof input === 'bigint') return makeRational(input, 1n);

  const raw = String(input ?? '').trim();
  if (raw === '') throw new InputError('EMPTY_INPUT', '输入为空');

  if (/\d\s*[eE]\s*[+-]?\d/.test(raw) || /^[+-]?\d*\.?\d+[eE][+-]?\d+$/.test(raw)) {
    throw new InputError('SCIENTIFIC_NOTATION', '不支持科学计数法');
  }

  // 非法字符快速拒绝（仅允许数字、符号、点、斜杠、空白）。
  if (/[^0-9+\-./\s]/.test(raw)) {
    throw new InputError('NOT_A_NUMBER', '包含非法字符');
  }
  if (countDigits(raw) > MAX_INPUT_DIGITS) {
    throw new InputError('INPUT_TOO_LARGE', `输入数字位数超过上限 ${MAX_INPUT_DIGITS}`);
  }

  // 负号只允许在整体最前面。
  let sign = 1n;
  let body = raw;
  if (body.startsWith('-')) {
    sign = -1n;
    body = body.slice(1).trim();
  } else if (body.startsWith('+')) {
    body = body.slice(1).trim();
  }

  // 以空白拆分为“整数部分 + 分数部分”。
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length > 2) {
    throw new InputError('NOT_A_NUMBER', '输入分段过多');
  }

  let result: Rational;
  if (tokens.length === 1) {
    const t = tokens[0];
    if (t.includes('/')) {
      result = parsePlainFraction(t);
    } else {
      result = parseDecimalPart(t);
    }
  } else {
    const whole = parseDecimalPart(tokens[0]);
    const frac = parsePlainFraction(tokens[1]);
    if (whole.num < 0n || frac.num < 0n) {
      throw new InputError('NOT_A_NUMBER', '带分数内部不允许额外负号');
    }
    result = add(whole, frac);
  }

  if (sign === -1n && result.num !== 0n) result = { num: -result.num, den: result.den };
  return result;
}

function parsePlainFraction(t: string): Rational {
  const parts = t.split('/');
  if (parts.length !== 2) throw new InputError('NOT_A_NUMBER', '分数格式应为 p/q');
  const [ps, qs] = parts;
  if (!/^[+-]?[0-9]+$/.test(ps) || !/^[0-9]+$/.test(qs)) {
    throw new InputError('NOT_A_NUMBER', '分数的分子分母必须是整数');
  }
  const p = BigInt(ps);
  const q = BigInt(qs);
  return makeRational(p, q); // q=0 时抛 ZERO_DENOMINATOR
}

export function add(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function neg(a: Rational): Rational {
  return { num: -a.num, den: a.den };
}

export function abs(a: Rational): Rational {
  return a.num < 0n ? { num: -a.num, den: a.den } : a;
}

// 精确绝对值误差：|a - p/q|，返回已约分分数。
export function absError(x: Rational, p: bigint, q: bigint): Rational {
  const num = x.num * q - p * x.den;
  return makeRational(num < 0n ? -num : num, x.den * q);
}

// 比较两个已约分正误差分数；返回 -1/0/1。
export function cmpRational(a: Rational, b: Rational): number {
  const lhs = a.num * b.den;
  const rhs = b.num * a.den;
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

// 比较候选 (p,q)：先比误差，平局比分母，再平局比分子（均取较小者）。
// 返回负数表示 a 更优。
export function compareCandidates(
  ea: Rational,
  pa: bigint,
  qa: bigint,
  eb: Rational,
  pb: bigint,
  qb: bigint
): number {
  const c = cmpRational(ea, eb);
  if (c !== 0) return c;
  if (qa !== qb) return qa < qb ? -1 : 1;
  if (pa !== pb) return pa < pb ? -1 : 1;
  return 0;
}
