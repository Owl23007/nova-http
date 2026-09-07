import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Nova Http",
  description: "A fast and lightweight HTTP framework for Node.js",
  themeConfig: {
    nav: [
      { text: "首页", link: "/" },
      { text: "指南", link: "/guide/introduction" },
      { text: "测试文档", link: "/testing/index" },
    ],

    sidebar: [
      {
        text: "入门指南",
        items: [
          { text: "简介", link: "/guide/introduction" },
          { text: "快速开始", link: "/guide/getting-started" },
        ],
      },
      {
        text: "核心功能",
        items: [
          { text: "路由 (Router)", link: "/guide/router" },
          { text: "中间件 (Middleware)", link: "/guide/middleware" },
          { text: "流式响应", link: "/guide/streaming-response" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/your-name/nova" }],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026-present 沃以",
    },
  },
});
