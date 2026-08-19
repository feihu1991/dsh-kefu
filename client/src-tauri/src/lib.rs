//! DSH 客服平台桌面客户端（Tauri 2）
//!
//! 壳子职责：记住服务器地址 -> 打开 WebView 加载 {server}/kefu/。
//! 登录、商家管理、Agent、聊天全部由服务器端插件（dsh-kefu）提供。

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::{Manager, State};

/// 应用配置：服务器地址等（存在系统数据目录 config.json）
#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
struct AppConfig {
    server_url: String,
}

struct ConfigState {
    path: PathBuf,
}

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("failed to resolve app config dir")
        .join("config.json")
}

/// 读取配置
#[tauri::command]
fn get_config(state: State<'_, ConfigState>) -> AppConfig {
    fs::read_to_string(&state.path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// 保存配置
#[tauri::command]
fn set_config(state: State<'_, ConfigState>, server_url: String) -> Result<(), String> {
    let cfg = AppConfig { server_url };
    if let Some(dir) = state.path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&state.path, serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// 用系统默认浏览器打开地址
#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    let status = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", &url]).status()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&url).status()
    } else {
        Command::new("xdg-open").arg(&url).status()
    }
    .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("浏览器打开失败".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = config_path(app.handle());
            app.manage(ConfigState { path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, set_config, open_in_browser])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
