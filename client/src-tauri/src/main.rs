// 防止在非调试构建中弹出多余的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kefu_client_lib::run()
}
