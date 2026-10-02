import http from "node:http";
import net from "node:net";
import { validBody } from "./scenarios.js";

export async function validate(port, scenario, path = scenario.path, expected = scenario.expected) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: scenario.method,
        headers: scenario.body
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(scenario.body),
            }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          if (
            res.statusCode !== 200 ||
            res.headers["content-type"] !== scenario.type ||
            !validBody(Buffer.concat(chunks), expected)
          )
            reject(new Error("响应状态、类型或正文不一致"));
          else resolve(res.headers);
        });
      },
    );
    req.setTimeout(3000, () => req.destroy(new Error("响应校验超时")));
    req.on("error", reject);
    req.end(scenario.body);
  });
}

export async function validatePipeline(port, scenario) {
  // 同一连接发送可区分的请求，验证流水线顺序和完整性
  const count = 10;
  const requests = Array.from({ length: count }, (_, i) => {
    const path = scenario.path.startsWith("/users/") ? `/users/${i}?q=item${i}` : scenario.path;
    const body = scenario.body ? JSON.stringify({ sequence: i }) : "";
    const expected = scenario.body
      ? { sequence: i }
      : path.startsWith("/users/")
        ? { id: String(i), q: `item${i}` }
        : scenario.expected;
    return {
      expected,
      wire: `${scenario.method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: ${i === count - 1 ? "close" : "keep-alive"}\r\n${body ? `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n` : ""}\r\n${body}`,
    };
  });
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.connect(port, "127.0.0.1", () =>
      socket.write(requests.map((r) => r.wire).join("")),
    );
    socket.setTimeout(5000, () => socket.destroy(new Error("流水线校验超时")));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("end", () => {
      socket.destroy();
      resolve(Buffer.concat(chunks).toString());
    });
  });
  const responses = raw.split(/HTTP\/1\.1 /).slice(1);
  if (responses.length !== count) throw new Error("流水线响应数量不一致");
  for (let i = 0; i < count; i++) {
    const split = responses[i].indexOf("\r\n\r\n");
    const head = responses[i].slice(0, split);
    const body = responses[i].slice(split + 4);
    const length = /content-length:\s*(\d+)/i.exec(head);
    if (
      !head.startsWith("200 ") ||
      !length ||
      Buffer.byteLength(body) !== Number(length[1]) ||
      !validBody(body, requests[i].expected)
    )
      throw new Error("流水线响应顺序或完整性错误");
  }
}
