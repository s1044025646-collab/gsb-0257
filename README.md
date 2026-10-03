# 有限分母分数近似与连分数解释后端

在分母不超过上限 D 的所有分数中，找出与输入数值**绝对误差最小**的约分分数 `p/q`。
全部计算使用 BigInt 精确有理数运算，十进制输入**绝不经过浮点**；小数仅用于展示。
只做这一类近似：不求多项式根、不涉及物理单位、不是通用符号代数系统。

技术栈：TypeScript + Node.js（>= 22.5，使用内置 `node:sqlite` 与 `node:http`，零运行时依赖）+ SQLite。Windows 本地运行，不需要 Docker / WSL / 外部服务。

## 快速开始

```powershell
npm install        # 安装开发依赖（typescript、@types/node）
npm run build      # 编译到 dist/
npm test           # 编译并运行全部测试
npm start          # 启动 API（默认自动选择空闲端口）
npm run demo       # 运行演示脚本（结果写入 data/demo.db）
```

## 输入规范

| 形式 | 示例 | 说明 |
| --- | --- | --- |
| 整数 | `-42` | |
| 有限十进制 | `3.141592653589793`、`.25` | 按精确有理数解释，拒绝科学计数法 |
| 分数 | `22/7`、`-355/113` | 自动约分，分母为零拒绝 |
| 带整数部分分数 | `3 1/2`、`-3 1/2` | 负号作用于整体 |

公开上限（`GET /api/config` 或 `cli config` 可查）：

- 最大分母 D：`1 .. 10^12`（必须是正整数）
- 输入数字位数：最多 1000 位

错误码：`ZERO_DENOMINATOR`、`SCIENTIFIC_NOTATION`、`BAD_FORMAT`、`EMPTY_INPUT`、`BAD_TYPE`、`INPUT_TOO_LONG`、`BAD_DENOMINATOR_LIMIT`、`DENOMINATOR_LIMIT_TOO_LARGE`、`NOT_FOUND`、`BAD_JSON`。非法输入整体拒绝，不截断后继续计算。

## 算法说明

1. 对 `|x|` 做连分数展开，得到部分商与全部收敛分数（BigInt 递推）。
2. 取最后一个分母不超过 D 的收敛分数；若它就是 x 本身（有限连分数终止点），误差为零，直接返回约分后的原值。
3. 否则计算上限处的中间（半收敛）候选 `t = floor((D - k_{n-1}) / k_n)`，与收敛分数用**整数交叉相乘**精确比较误差。
4. 平局规则（稳定）：误差相同取较小分母；再相同取较小 |分子|；再相同取较小分子。
5. 负数通过对绝对值近似后恢复符号；零表示为 `0/1`。

## CLI

```powershell
node dist/cli.js calc 3.141592653589793 --d 10     # -> 22/7
node dist/cli.js calc 3.141592653589793 --d 113    # -> 355/113
node dist/cli.js calc 0.5 --d 1                    # 平局 -> 0/1
node dist/cli.js calc 22/7 --d 7                   # 精确，误差 0/1
node dist/cli.js batch items.json                  # 批量，失败条目带 index 与错误码
node dist/cli.js compare 3.141592653589793 --d 10,113,1000,33102
node dist/cli.js steps 1                           # 连分数步骤与候选误差
node dist/cli.js history --limit 20
node dist/cli.js export --out backup.ndjson
node dist/cli.js serve --port 8787                 # 省略 --port 时选择空闲端口
node dist/cli.js config
```

通用选项：`--db <路径>` 指定数据库（默认 `data/approx.db`），`--no-save` 只计算不入库。

批量文件格式（`items.json`）：

```json
[
  { "input": "0.5", "maxDenominator": 1 },
  { "input": "22/7", "maxDenominator": 7 },
  { "input": "1/0", "maxDenominator": 10 }
]
```

## API

启动：`npm start` 或 `node dist/cli.js serve --port 8787`（也可用环境变量 `PORT`）。

| 方法与路径 | 说明 |
| --- | --- |
| `POST /api/approx` | 单条近似，body `{ "input": "3.14", "maxDenominator": "100", "save": true }` |
| `POST /api/approx/batch` | 批量，body `{ "items": [...] }`，每条独立报告成功/失败 |
| `POST /api/approx/compare` | 上限对照，body `{ "input": "...", "limits": ["10","113"] }` |
| `GET /api/history?limit=&offset=` | 历史查询 |
| `GET /api/history/:id` | 单条完整快照 |
| `GET /api/history/:id/steps` | 连分数步骤与候选误差 |
| `GET /api/export` | 导出全部记录（NDJSON） |
| `GET /api/config` | 公开上限与输入版本 |

输出包含：规范输入（约分后的 `p/q`）、所选分子分母、精确误差分数、展示用小数、选择依据、完整连分数、每步收敛分数及误差、参与比较的候选列表。

## 存储

SQLite 保存在项目内 `data/` 目录（可用 `--db` 更改）。每条记录包含：创建时间、输入版本（`v1`）、原始输入、D、完整分析快照（JSON）。历史记录不可变——之后用其他上限重新计算不会改动旧报告；服务重启后原有计算与解释仍可读取。

## 已知限制

- `node:sqlite` 在 Node 25 仍标记为实验特性（启动时有 ExperimentalWarning），接口未来可能微调。
- 展示用小数固定截取 12 位并加省略号，不参与任何判断。
- 输入必须一次性给全（单条或批量数组），不提供流式计算。
