# 发布

版本以 `package.json` 为准，`package-lock.json`、Git 标签和 Release 附件保持一致。候选版使用 `x.y.z-rc.N`，标记为 GitHub prerelease；正式版由维护者显式决定。

## 构建与验证

需要 macOS Apple Silicon、Node.js 22.12 或更新版本、Xcode Command Line Tools、可运行的 Pi 和图形桌面。提交源码后执行：

```sh
npm run release:build
```

脚本只构建干净提交，不覆盖正在运行的目标应用，并依次执行类型检查、单元测试、Electron/PTY 回归和安装包回归。失败后停止发布。

产物位于 `dist-v<version>/`：

- `Pi Console-darwin-arm64/Pi Console.app`
- `Pi-Console-<version>-macOS-arm64.zip`
- `SHA256SUMS.txt` 和包含提交、版本、架构及摘要的 `release.json`

安装包为 ad-hoc 签名，不是 Developer ID 签名或公证。发布前核对项目地址、许可证、截图、源码与附件是否包含私有信息；用 `shasum -a 256 -c SHA256SUMS.txt` 验证压缩包。

## 上传

首个公开版本的 Release 说明以应用介绍、主要特性和安装须知为主，不罗列内部构建或同版本覆盖过程；后续版本再按 Feature、Bugfix 等分类简述实际变化，必要时注明兼容性或升级注意事项。

维护者在确认仓库、提交和标签后手动创建 Release，上传 ZIP、`SHA256SUMS.txt` 和 `release.json`。先验证下载和校验和，再公开发布；不要把 Pi 历史、凭据、测试产物或本地备份上传。

关闭旧应用和 relay 前先确认不会中断任务；不要为清理构建目录终止用户会话。构建产物可以删除重建，应用运行不依赖发布脚本。
