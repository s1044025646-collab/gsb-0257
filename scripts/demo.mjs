// 演示脚本：覆盖题目要求的关键场景
import { execFileSync } from "node:child_process";

const cli = ["dist/cli.js"];
const run = (args) => {
  const full = [...args, "--db", "data/demo.db"];
  console.log(`\n$ node ${cli[0]} ${full.join(" ")}`);
  try {
    process.stdout.write(execFileSync("node", [...cli, ...full], { encoding: "utf8" }));
  } catch (e) {
    process.stdout.write(e.stdout ?? "");
    process.stderr.write(e.stderr ?? "");
  }
};

run(["calc", "3.141592653589793", "--d", "10"]);
run(["calc", "3.141592653589793", "--d", "113"]);
run(["calc", "0.5", "--d", "1"]);
run(["calc", "22/7", "--d", "7"]);
run(["calc", "-2.718281828", "--d", "100"]);
run(["calc", "0.7", "--d", "8"]);
run(["compare", "3.141592653589793", "--d", "10,113,1000,33102"]);
run(["history", "--limit", "10"]);
run(["steps", "1"]);
