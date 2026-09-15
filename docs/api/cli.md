---
description: 项目创建命令、模板、语言选项与双包版本关系。
---

# CLI

项目创建由 `create-nova-http` initializer 提供，`nova-http create` 调用同一套生成逻辑。生成后需要安装依赖。

::: code-group

```sh [npm create]
npm create nova-http@latest my-app -- --template api --lang ts
```

```sh [initializer]
npx create-nova-http@latest my-app --template api --lang ts
```

```sh [framework CLI]
npx nova-http create my-app --template api --lang ts
```

:::

## 参数

| 参数               | 默认值         | 说明                               |
| ------------------ | -------------- | ---------------------------------- |
| `name`             | 必填或交互输入 | 项目目录名称，不能包含路径分隔符   |
| `--template`       | `minimal`      | minimal 或 api                     |
| `--lang`           | `ts`           | ts 或 js                           |
| `--force` / `-f`   | false          | 覆盖已有目标目录；会移除原目录内容 |
| `--help` / `-h`    | —              | 显示用法，放在命令入口后           |
| `--version` / `-v` | —              | 显示 CLI 版本                      |

minimal 提供单文件起点；api 提供路由、中间件和身份校验示例。模板是应用起点，认证演示不等同于生产身份系统。

## 版本关系

initializer 与框架包同步版本，生成应用的依赖范围指向对应框架版本。例如仓库当前 0.2.1 的 initializer 生成 `nova-http@^0.2.1`。npm 的 latest 取决于实际发布状态，不能保证包含本站描述的所有工作区重构。

本地调试与打包验证见[发布流程](../framework/contributing/release)。
