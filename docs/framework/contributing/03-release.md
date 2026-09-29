---
description: Changesets、双包同步、CLI 模板验证与发布工作流。
---

# 发布流程

仓库通过 Changesets 管理包版本与日志，发布工作流在 master 上运行。nova-http 与 initializer 的版本、模板依赖和打包产物需要保持一致。

## 描述用户可见变更

```sh
pnpm changeset
```

说明具体触发条件、变更后的行为及迁移需求。破坏性接口调整同时更新 API 和迁移页；内部文件移动但公开契约不变时，不应写成用户必须修改导入。

## 验证产物

完成类型、测试和构建后执行：

```sh
pnpm check:release
pnpm check:templates
pnpm check:cli
```

check:release 验证包和模板版本关系，check:templates 检查 TS 模板，check:cli 验证打包 CLI 的项目生成。CI 另对两个包执行 npm pack --dry-run，确保包包含需要的入口和模板。

## 版本与发布

根 `pnpm version` 调用 changeset version，会修改版本和日志；`pnpm release` 执行 changeset publish，会发布到 npm。日常文档修改无需执行这两个命令。

发布自动化见 [release.yml](https://github.com/Owl23007/nova-http/blob/master/.github/workflows/release.yml)。版本发布后更新[版本说明](../../releases/)，将未发布迁移关联实际版本。不要仅根据工作区 package.json 推断 npm 的 latest 标签。
