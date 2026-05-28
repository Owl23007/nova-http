export function resourceMiddleware(resources) {
  return (req, _res, next) => {
    // 将基础设施依赖挂到请求上下文，业务 subapp 不直接 import 全局单例。
    req.context.db = resources.db;
    req.context.redis = resources.redis;
    next();
  };
}

export function redisCounterMiddleware(namespace) {
  return async (req, _res, next) => {
    // 用 Redis 记录接口访问计数，既验证中间件链路，也模拟真实服务的轻量统计写入。
    const key = `${namespace}:requests:${req.method}:${req.pathname}`;
    req.context.redisRequestCount = await req.context.redis.incr(key);
    next();
  };
}
