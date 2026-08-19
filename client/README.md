# KefuClient — DSH 客服平台桌面客户端

基于 **Tauri 2** 的桌面壳子（Windows / macOS / Linux）。它不做任何业务逻辑，
只负责：**记住服务器地址 → 在应用窗口里打开 `{服务器}/kefu/` 客服平台**。

## 构建

需要本机安装 Rust 工具链（https://rustup.rs）：

```bash
cd client
npm install
npm run tauri build          # 产物在 src-tauri/target/release/bundle/
# 开发模式（热重载壳子界面）：
npm run tauri dev
```

> 打包时若提示缺少图标格式（icns/ico），先执行 `npm run icons`
> （基于 public-icon.png 生成全套），再重新 build。

## 使用

1. 启动应用 → 输入服务器地址（如 `http://192.168.1.100:3080`）
2. 点「保存并连接」→ 窗口内打开客服平台登录页
3. 也可以随时「用浏览器打开」

服务器地址保存在系统配置目录 `config.json` 中，不会随应用更新丢失。
