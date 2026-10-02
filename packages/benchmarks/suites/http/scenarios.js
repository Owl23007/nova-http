export const scenarios = {
  "json-small": {
    path: "/",
    method: "GET",
    expected: { hello: "world" },
    type: "application/json; charset=utf-8",
  },
  text: { path: "/", method: "GET", expected: "hello world", type: "text/plain; charset=utf-8" },
  "params-query": {
    path: "/users/42?q=nova",
    method: "GET",
    expected: { id: "42", q: "nova" },
    type: "application/json; charset=utf-8",
  },
  "json-echo": {
    path: "/",
    method: "POST",
    body: JSON.stringify({ id: 123, name: "benchmark", tags: ["nova", "http"], active: true }),
    expected: { id: 123, name: "benchmark", tags: ["nova", "http"], active: true },
    type: "application/json; charset=utf-8",
  },
  "middleware-5": {
    path: "/",
    method: "GET",
    expected: { layers: 5 },
    type: "application/json; charset=utf-8",
  },
};

export function validBody(body, expected) {
  try {
    const actual = typeof expected === "string" ? String(body) : JSON.parse(String(body));
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}
