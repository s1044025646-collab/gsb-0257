# frac-approx：有限分母分数近似与连分数解释后端

纯后端服务（仅 HTTP API + CLI，无前端）。输入一个整数、有限十进制字符串或分数字符串，
给定最大分母 `D`，求与输入绝对误差最小的**约分**分数 `p/q`（`1 <= q <= D`）。
全程使用 `BigInt` 精确有理数运算，**十进制绝不先转浮点**；小数仅用于展示。

- 运行时：Node.js（>= 22.5，开发于 Node v25），TypeScript
- 存储：内置 `node:sqlite`（Node 自带，**无需原生编译、无需 Docker/WSL**）
- 平台：Windows 本地直接运行

## 目录

- `src/rational.ts`：精确有理数、解析、交叉相乘比较、错误码与公开上限
- `src/approx.ts`：**核心算法**——连分数展开、收敛分数、上限处中间候选；另含暴力枚举（测试核对用）
- `src/decimal.ts`：展示用有限小数（除不尽截断并标注 `…`）
- `src/service.ts`：计算报告、`D` 校验、上限对照
- `src/store.ts`：SQLite 建表、写入、历史查询（算例 + 输入版本 + 快照）
- `src/server.ts`：HTTP API（默认空闲端口，可用 `PORT` 指定）
- `src/cli.ts`：命令行
- `src/test/`：单元测试（算法与暴力枚举核对、平局、持久化/重启）
- `scripts/demo.ts`：演示脚本

## 核心算法

对 `|x|`（非负有理数）做标准欧几里得连分数展开得到有限部分商，递推全部收敛分数：

1. 所有满足 `q <= D` 的收敛分数纳入候选；
2. 当某个收敛分数 `q_(n+1) > D` 而 `q_n <= D` 时，加入**上限处的中间分数**
   `(k·p_n + p_(n-1)) / (k·q_n + q_(n-1))`，其中
   `k = floor((D - q_(n-1)) / q_n)` 是使分母不超过 `D` 的最大整数。
   中间分数误差随 `k` 单调下降，因此只检验最大可行 `k` 即可，效率与位数无关；
3. 用**整数交叉相乘**比较候选与目标的绝对误差。负数先对 `|x|` 求解再翻号。

这不是“只取最后一个未超限收敛分数”，也不是“分母四舍五入”，而是覆盖了完整最优候选集。
测试中用独立的**暴力枚举**（对每个 `q=1..D` 检查目标附近两个/三个分子）逐一核对。

### 平局规则（稳定）

误差相等时：先取**较小分母**；仍相同再取**较小分子**。例：`0.5`,`D=1` 时
`0/1` 与 `1/1` 误差都是 `1/2`，分母相同，取分子更小的 `0/1`。

### 终止与特殊值

- 有理数连分数恒**有限**，报告中 `finite=true` 并给出全部部分商；
- 零表示为 `0/1`；负数仅分子带符号、分母恒正；
- 若输入约分后分母已满足限制，直接返回原值且误差为 `0`。

## 输入规则与公开上限

- 支持：`3`、`-3`、`3.14`、`.5`、`2/3`、`-2/3`、`1 1/2`、`-1 1/2`（空格分隔带分数）
- 数字位数上限：**200 位**（`MAX_INPUT_DIGITS`，超限拒绝，不截断）
- 最大分母 `D`：**正整数，1 <= D <= 1,000,000**（`MAX_D`）
- 拒绝：零分母、非数字、**科学计数法**（如 `1e3`）、超限输入、直接传 `number`/浮点

错误码：`ZERO_DENOMINATOR`、`NOT_A_NUMBER`、`SCIENTIFIC_NOTATION`、`INPUT_TOO_LARGE`、
`EMPTY_INPUT`、`FLOAT_INPUT_FORBIDDEN`、`D_NOT_INTEGER`、`D_NOT_POSITIVE`、`D_TOO_LARGE`、
`MISSING_INPUT`、`INVALID_JSON`、`BATCH_TOO_LARGE`、`NOT_FOUND` 等。

## 构建、测试、启动、演示

```powershell
npm install
npm run build     # tsc 编译到 dist/
npm test          # 编译并运行 node:test（含暴力枚举核对与持久化测试）
npm run demo      # 运行演示（pi 的 22/7、355/113，0.5 平局，精确误差等）
npm start         # 启动 HTTP 服务；默认自动选空闲端口，启动日志打印实际 URL
```

指定端口或数据库文件：

```powershell
$env:PORT="8080"; $env:FRAC_DB_PATH="data/frac.db"; npm start
```

## CLI

```powershell
node dist/src/cli.js calc "3.141592653589793" 113   # 单条（写入 DB，打印步骤/候选）
node dist/src/cli.js steps "4/7" 3                  # 连分数步骤与候选误差
node dist/src/cli.js batch "0.5:1,-2/3:2,7:3"       # 批量（失败条目标注下标与错误码）
node dist/src/cli.js compare "3.14159" 10,50,113    # 上限对照
node dist/src/cli.js history 20                     # 历史
node dist/src/cli.js get 1                          # 某条完整解释快照（JSON）
node dist/src/cli.js export out.csv                 # 导出 CSV
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/health` | 健康检查与公开上限 |
| POST | `/api/approx` | `{ "input": "3.14159", "maxDenominator": 113 }` |
| POST | `/api/approx/batch` | `{ "items": [ { "input": "...", "maxDenominator": 10 }, ... ] }`（失败准确定位 `index`） |
| POST | `/api/compare` | `{ "input": "3.14159", "denominators": [10, 113] }` |
| GET  | `/api/history?limit=&offset=&input=&maxDenominator=` | 历史查询 |
| GET  | `/api/history/:id` | 单条完整分析快照 |
| GET  | `/api/export` | 导出 CSV（UTF-8 BOM） |

报告字段包含：规范化输入、`inputVersion`（`frac-approx/input/v1`）、输入的精确分数与展示小数、
所选分子/分母、**精确误差分数**及展示小数、`exact`、选择依据、连分数部分商与逐步收敛分数、
全部候选（含 `convergent`/`intermediate` 标记）及其精确误差。

## 不可变快照

每次计算把输入、输入版本、`D`、`schema_version` 与**完整分析快照**整体写入 SQLite。
之后用更大 `D` 重算只会新增记录，**不会修改旧报告**；服务重启后仍可读取原计算与解释。

## 范围与限制

- 只做“有限分母下的单值分数近似 + 连分数解释”，不做多项式根、单位换算或通用符号代数。
- `D` 上限 1,000,000、输入 200 位为防滥用的显式限制；如需调整改 `src/rational.ts` 常量。
- 存储为项目内 `data/`（SQLite WAL 文件）。
