const page = (text, link) => ({ text, link });
export const navigation = [
  { text: "应用开发", link: "/guide/01-introduction", activeMatch: "/guide/" },
  { text: "API 参考", link: "/api/", activeMatch: "/api/" },
  { text: "框架设计", link: "/framework/", activeMatch: "/(framework|proposals|testing)/" },
  { text: "版本与迁移", link: "/releases/", activeMatch: "/releases/" },
];
const guide = [
  {
    text: "开始",
    items: [
      page("简介", "/guide/01-introduction"),
      page("快速开始", "/guide/02-getting-started"),
      page("项目组织", "/guide/03-project-structure"),
    ],
  },
  {
    text: "构建应用",
    items: [
      page("路由与子应用", "/guide/04-router"),
      page("中间件", "/guide/05-middleware"),
      page("请求与上下文", "/guide/06-request"),
      page("请求体", "/guide/07-request-body"),
      page("响应", "/guide/08-response"),
      page("错误处理", "/guide/09-error-handling"),
      page("生命周期钩子", "/guide/10-hooks"),
    ],
  },
  {
    text: "生产实践",
    items: [
      page("流式响应", "/guide/11-streaming-response"),
      page("静态文件", "/guide/12-static-files"),
      page("应用测试", "/guide/13-testing"),
      page("部署与运行", "/guide/14-deployment"),
    ],
  },
  {
    text: "完整示例",
    items: [
      page("JSON API", "/guide/recipes/01-rest-api"),
      page("SSE 事件流", "/guide/recipes/02-sse"),
      page("文件下载", "/guide/recipes/03-file-download"),
    ],
  },
];
const framework = [
  {
    text: "理解与扩展",
    items: [
      page("开发路线", "/framework/"),
      page("扩展开发", "/framework/01-extensions"),
      page("架构与边界", "/framework/02-architecture"),
      page("请求生命周期", "/framework/03-request-lifecycle"),
    ],
  },
  {
    text: "内核实现",
    collapsed: false,
    items: [
      page("消息契约", "/framework/internals/01-message"),
      page("应用分发", "/framework/internals/02-core"),
      page("HTTP/1 协议", "/framework/internals/03-http1"),
      page("连接与服务器", "/framework/internals/04-server"),
      page("响应与取消", "/framework/internals/05-response-lifecycle"),
    ],
  },
  {
    text: "参与贡献",
    items: [
      page("本地开发", "/framework/contributing/01-setup"),
      page("测试与回归", "/framework/contributing/02-testing"),
      page("发布流程", "/framework/contributing/03-release"),
      page("文档维护", "/framework/contributing/04-documentation"),
    ],
  },
  {
    text: "工程记录",
    items: [
      page("性能验证", "/framework/performance/"),
      page("设计记录", "/proposals/"),
      page("流式响应需求", "/proposals/01-streaming-response-prd"),
      page("流式响应原始设计", "/proposals/02-streaming-response-technical-design"),
      page("文档站架构", "/proposals/03-documentation-architecture"),
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
        page("应用实例", "/api/01-app"),
        page("配置", "/api/02-configuration"),
        page("路由", "/api/03-routing"),
        page("NovaRequest", "/api/04-request"),
        page("NovaResponse", "/api/05-response"),
        page("Hooks", "/api/06-hooks"),
        page("内置中间件", "/api/07-middleware"),
        page("文件适配器", "/api/08-static"),
        page("CLI", "/api/09-cli"),
        page("错误参考", "/api/10-errors"),
      ],
    },
    {
      text: "扩展 API",
      items: [
        page("应用内核", "/api/11-core"),
        page("消息契约", "/api/12-message"),
        page("HTTP/1 工具", "/api/13-http1"),
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
        page("Core API 迁移", "/releases/migrations/01-core-api"),
      ],
    },
  ],
};
