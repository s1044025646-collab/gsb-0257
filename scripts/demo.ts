import { resolve } from 'node:path';
import { openDb } from '../src/store.js';
import { buildReport } from '../src/service.js';

const db = openDb(resolve('data/demo.db'));

function show(title: string, input: string, D: bigint) {
  const r = buildReport(input, D);
  console.log(`【${title}】 ${input}  D=${D}`);
  console.log(`  目标值   : ${r.inputValueFraction} ≈ ${r.inputDecimal}`);
  console.log(`  最优分数 : ${r.bestFraction}  (≈ ${r.bestDecimal})`);
  console.log(`  精确误差 : ${r.exactErrorFraction} ≈ ${r.exactErrorDecimal}${r.exact ? '  [精确]' : ''}`);
  console.log(`  连分数项 : [${r.continuedFraction.terms.join(', ')}]  (有限=${r.continuedFraction.finite})`);
  console.log('');
}

console.log('有限分母分数近似演示\n');
show('圆周率 D=10', '3.141592653589793', 10n);
show('圆周率 D=113', '3.141592653589793', 113n);
show('平局规则 0.5 D=1', '0.5', 1n);
show('精确表示 1/4 D=8', '1/4', 8n);
show('负数 -pi D=10', '-3.141592653589793', 10n);
show('带分数 1 3/8 D=3', '1 3/8', 3n);

console.log('D 增大时误差单调不增（pi）:');
let prev = '';
for (const D of [1n, 2n, 5n, 7n, 10n, 50n, 113n]) {
  const r = buildReport('3.141592653589793', D);
  console.log(`  D=${String(D).padStart(3)} -> ${r.bestFraction.padEnd(8)} 误差 ${r.exactErrorFraction}`);
  prev = r.exactErrorFraction;
}
void db;
void prev;
console.log('\n演示完成。');
