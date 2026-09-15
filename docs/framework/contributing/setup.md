---
description: 配置 pnpm 工作区，构建框架与文档，定位日常开发命令。
---

# 本地开发

仓库使用 pnpm workspace，包含 nova-http、create-nova-http 和 nova-docs。贡献工具链按 CI 使用 Node.js 24，pnpm 版本由根 packageManager 固定。

## 安装与构建

```sh
git clone https://github.com/Owl23007/nova-http.git
cd nova-http
pnpm install --frozen-lockfile
pnpm -F nova-http build
pnpm -F create-nova-http build
```

根目录 `pnpm build` 递归构建包及文档站。只修改框架时可使用上面的过滤构建，避免重复构建文档。

## 日常命令

| 命令                            | 用途                   |
| ------------------------------- | ---------------------- |
| `pnpm -F nova-http build:watch` | 持续编译框架           |
| `pnpm typecheck`                | 包类型检查             |
| `pnpm lint`                     | 源码 lint              |
| `pnpm format:check`             | 格式检查               |
| `pnpm docs:dev`                 | 本地文档预览           |
| `pnpm docs:build`               | 文档生产构建与链接检查 |

源码在 `packages/nova-http/src`，测试在 `packages/nova-http/scripts/tests`。CLI 模板在 `cli/templates`；验证涉及真实生成目录时使用临时路径。

## 环境差异

普通单元测试不需要数据库。全量测试中的生产场景套件需要 Redis 与支持 node:sqlite 的 Node 版本；CI 在 Node 20 排除该套件，在 Node 22/24 执行完整测试。准确命令见[测试与回归](./testing)。

提交前按变更范围完成检查，并通过 Changeset 记录面向用户的包行为变更。文档贡献规范见[文档维护](./documentation)。
