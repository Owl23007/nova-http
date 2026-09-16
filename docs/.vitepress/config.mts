import { defineConfig } from "vitepress";
import { navigation, sidebar } from "./navigation.mjs";

const base = process.env.DOCS_BASE ?? "/";

export default defineConfig({
  base,
  lang: "zh-CN",
  title: "Nova",
  description: "基于 Node.js TCP 的 HTTP 框架：应用开发、API 参考与内核实现。",
  lastUpdated: true,
  cleanUrls: true,
  head: [["link", { rel: "icon", type: "image/svg+xml", href: `${base}nova.svg` }]],
  markdown: { theme: { light: "github-light", dark: "github-dark" } },
  themeConfig: {
    logo: "/nova.svg",
    siteTitle: "Nova",
    nav: navigation,
    sidebar,
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
              modal: {
                noResultsText: "没有找到相关文档",
                resetButtonTitle: "清除搜索",
                displayDetails: "显示详细内容",
                footer: { selectText: "选择", navigateText: "切换", closeText: "关闭" },
              },
            },
          },
        },
      },
    },
    outline: { level: [2, 3], label: "本页内容" },
    docFooter: { prev: "上一篇", next: "下一篇" },
    darkModeSwitchLabel: "外观",
    darkModeSwitchTitle: "切换为深色模式",
    lightModeSwitchTitle: "切换为浅色模式",
    sidebarMenuLabel: "文档目录",
    returnToTopLabel: "返回顶部",
    lastUpdated: { text: "最后更新", formatOptions: { dateStyle: "medium" } },
    editLink: {
      pattern: "https://github.com/Owl23007/nova-http/edit/master/docs/:path",
      text: "在 GitHub 上编辑此页",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/Owl23007/nova-http" }],
    footer: { message: "Nova · Node.js HTTP framework", copyright: "MIT License © Owl23007" },
  },
});
