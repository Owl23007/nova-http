import http from "node:http";

export function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: options.method || "GET",
        headers: options.headers || {},
        timeout: options.timeout || 1500,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
            reject(new Error(`[stress] ${url} returned ${res.statusCode}: ${body}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error(`[stress] request timed out: ${url}`));
    });
    req.end(options.body);
  });
}

export function requestOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const ok = res.statusCode === 200;
      res.resume();
      resolve(ok);
    });

    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}
