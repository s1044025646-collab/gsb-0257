import { parseInput, parseMaxDenominator, InputError } from "./parse.js";
import { approximate, ApproxResult } from "./approx.js";
import { Store } from "./store.js";

export interface BatchItemResult {
  index: number;
  input: string;
  maxDenominator?: string;
  ok: boolean;
  id?: number;
  result?: ApproxResult;
  error?: { code: string; message: string };
}

export class ApproxService {
  constructor(readonly store: Store) {}

  compute(rawInput: string, rawD: string | number, save = true): { id: number | null; result: ApproxResult } {
    const x = parseInput(rawInput);
    const D = parseMaxDenominator(rawD);
    const result = approximate(x, D, rawInput);
    const id = save ? this.store.save(rawInput, D, result) : null;
    return { id, result };
  }

  batch(items: { input: unknown; maxDenominator: unknown }[], save = true): BatchItemResult[] {
    return items.map((item, index) => {
      const input = item?.input;
      try {
        if (typeof input !== "string") {
          throw new InputError("BAD_TYPE", "input 必须是字符串");
        }
        const { id, result } = this.compute(input, String(item.maxDenominator ?? ""), save);
        return { index, input, maxDenominator: result.maxDenominator, ok: true, id: id ?? undefined, result };
      } catch (e) {
        const err = e as Error & { code?: string };
        return {
          index,
          input: String(input ?? ""),
          ok: false,
          error: { code: err.code ?? "INTERNAL", message: err.message },
        };
      }
    });
  }

  /** 上限对照：同一输入在多个 D 下的结果对比。 */
  compare(rawInput: string, limits: (string | number)[], save = true) {
    return limits.map((d) => {
      const { id, result } = this.compute(rawInput, d, save);
      return { id, maxDenominator: result.maxDenominator, result: result.result, error: result.error, exact: result.exact };
    });
  }
}
