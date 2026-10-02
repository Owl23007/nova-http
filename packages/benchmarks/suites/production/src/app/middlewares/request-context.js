export function requestContextMiddleware() {
  let requestSeq = 0;

  return (req, res, next) => {
    // 真实服务通常会透传上游 request id；压测流量没有时生成一个受控长度的本地 id
    const incomingId = req.getHeader("x-request-id");
    const requestId = incomingId && incomingId.length <= 128 ? incomingId : `req-${++requestSeq}`;

    req.context.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("cache-control", "no-store");
    next();
  };
}
