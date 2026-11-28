// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--mcp-bridge") {
        return duet_app_lib::bridge();
    }
    if std::env::args().any(|a| a == "--transcribe") {
        return duet_app_lib::transcribe();
    }
    if std::env::args().any(|a| a == "--find-speech") {
        return duet_app_lib::find_speech();
    }
    duet_app_lib::run()
}
