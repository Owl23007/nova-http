import { runMicro } from "./micro.js";

// 在独立进程中创建微基准对象，退出后彻底释放堆，不污染 HTTP 压测客户端
const preset = JSON.parse(process.argv[2]);
if (
  !Number.isInteger(preset.iterations) ||
  preset.iterations < 1 ||
  !Number.isInteger(preset.rounds) ||
  preset.rounds < 1
)
  throw new Error("Invalid microbenchmark preset");
console.log(JSON.stringify(await runMicro(preset)));
