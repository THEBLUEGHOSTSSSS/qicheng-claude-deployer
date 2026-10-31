# 参与启程

欢迎改进 Windows 部署体验、诊断信息、组件识别和中文界面。当前最需要可复现的 Windows 10/11 实测反馈。

## 报告问题

在 Issues 使用问题模板，提供系统版本/架构、启程版本、重现步骤、预期与实际结果。诊断报告也请在上传前人工检查。不要提交 API Key、完整 settings.json、备份、个人文件路径或未脱敏日志。安全漏洞改用 [安全报告渠道](SECURITY.md)。

## 本地开发

使用 Node.js 22.12+、npm 和 Python 3。`npm ci` 后运行 `npm run preview`，可在不修改本机 Claude 配置的情况下查看界面。`npm start` 在受支持的 Windows 上会启用真实检测；安装和写入需要用户确认。

```bash
npm test
python3 -m unittest tests.check_renderer -v
npm run test:ui
```

核心测试使用临时目录和假密钥；桌面检查分为真实预览和模拟 Windows bridge。不要用真实账户或系统配置替代失败的测试夹具。

## 提交 PR

1. 从 `main` 创建改动分支。
2. 简述具体问题和改变后的行为；较大的新功能先开 Issue 对齐范围。
3. 为配置读写、恢复、网络或新组件行为加入有意义的回归检查。
4. 运行受影响的测试，注明未运行的目标平台检查。
5. 仅提交源码、文档和需要的静态资源，不提交密钥、运行日志、安装包或 `node_modules`。

保持 renderer 无 Node 访问、无远程脚本、无任意 shell 入口。新增服务商不能携带真实密钥；新增安装入口需说明来源、验证方式及失败处理。下载摘要锁定需要同时更新来源和测试。

采用简洁提交标题，例如 `fix(config): preserve later edits during restore`。贡献按项目 MIT 许可证提供。
