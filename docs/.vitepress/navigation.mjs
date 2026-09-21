const page = (text, link) => ({ text, link });
export const navigation = [
  { text: "应用开发", link: "/guide/introduction", activeMatch: "/guide/" },
  { text: "API 参考", link: "/api/", activeMatch: "/api/" },
  { text: "框架设计", link: "/framework/", activeMatch: "/(framework|proposals|testing)/" },
  { text: "版本与迁移", link: "/releases/", activeMatch: "/releases/" },
];
const guide = [
  {
    text: "开始",
    items: [
      page("简介", "/guide/introduction"),
      page("快速开始", "/guide/getting-started"),
      page("项目组织", "/guide/project-structure"),
    ],
  },
  {
    text: "构建应用",
    items: [
      page("路由与子应用", "/guide/router"),
      page("中间件", "/guide/middleware"),
      page("请求与上下文", "/guide/request"),
      page("请求体", "/guide/request-body"),
      page("响应", "/guide/response"),
      page("错误处理", "/guide/error-handling"),
      page("生命周期钩子", "/guide/hooks"),
    ],
  },
  {
    text: "生产实践",
    items: [
      page("流式响应", "/guide/streaming-response"),
      page("静态文件", "/guide/static-files"),
      page("应用测试", "/guide/testing"),
      page("部署与运行", "/guide/deployment"),
    ],
  },
  {
    text: "完整示例",
    items: [
      page("JSON API", "/guide/recipes/rest-api"),
      page("SSE 事件流", "/guide/recipes/sse"),
      page("文件下载", "/guide/recipes/file-download"),
    ],
  },
];
const framework = [
  {
    text: "理解与扩展",
    items: [
      page("开发路线", "/framework/"),
      page("扩展开发", "/framework/extensions"),
      page("架构与边界", "/framework/architecture"),
      page("请求生命周期", "/framework/request-lifecycle"),
    ],
  },
  {
    text: "内核实现",
    collapsed: false,
    items: [
      page("消息契约", "/framework/internals/message"),
      page("应用分发", "/framework/internals/core"),
      page("HTTP/1 协议", "/framework/internals/http1"),
      page("连接与服务器", "/framework/internals/server"),
      page("响应与取消", "/framework/internals/response-lifecycle"),
    ],
  },
  {
    text: "参与贡献",
    items: [
      page("本地开发", "/framework/contributing/setup"),
      page("测试与回归", "/framework/contributing/testing"),
      page("发布流程", "/framework/contributing/release"),
      page("文档维护", "/framework/contributing/documentation"),
    ],
  },
  {
    text: "工程记录",
    items: [
      page("性能验证", "/framework/performance/"),
      page("设计记录", "/proposals/"),
      page("流式响应需求", "/proposals/streaming-response-prd"),
      page("流式响应原始设计", "/proposals/streaming-response-technical-design"),
      page("文档站架构", "/proposals/documentation-architecture"),
    ],
  },
];
export const sidebar = {
  "/guide/": guide,
  "/api/": [
    {
      text: "公共 API",
      items: [
        page("入口与导出", "/api/"),
        page("应用实例", "/api/app"),
        page("配置", "/api/configuration"),
        page("路由", "/api/routing"),
        page("NovaRequest", "/api/request"),
        page("NovaResponse", "/api/response"),
        page("Hooks", "/api/hooks"),
        page("内置中间件", "/api/middleware"),
        page("文件适配器", "/api/static"),
        page("CLI", "/api/cli"),
        page("错误参考", "/api/errors"),
      ],
    },
    {
      text: "扩展 API",
      items: [
        page("应用内核", "/api/core"),
        page("消息契约", "/api/message"),
        page("HTTP/1 工具", "/api/http1"),
      ],
    },
  ],
  "/framework/": framework,
  "/proposals/": framework,
  "/testing/": framework,
  "/releases/": [
    {
      text: "版本与迁移",
      items: [
        page("版本说明", "/releases/"),
        page("Core API 迁移", "/releases/migrations/core-api"),
      ],
    },
  ],
};
