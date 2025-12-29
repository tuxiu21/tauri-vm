# Tauri VM 控制台 (VMware Workstation)

通过 Tauri + React 构建的桌面端控制台：使用 SSH 连接到远程 Windows 主机，并调用 `vmrun.exe` 来查看虚拟机运行状态、远程启动/停止虚拟机。

## 前置条件

- 远程主机：Windows + OpenSSH Server（可被本机 SSH 访问）
- 远程主机：已安装 VMware Workstation，并可使用 `vmrun.exe`
  - 默认探测路径：`C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe` / `C:\Program Files\VMware\VMware Workstation\vmrun.exe`
- SSH 私钥：在应用里手动上传（保存在本机 app data 目录，不会打包进应用）

## 使用方法

1. 启动应用后进入「虚拟机」页，填写远程 `Host / Port / User`。
2. 在「添加虚拟机」中录入远程主机上的 VMX 路径（例如 `C:\VMs\Ubuntu\Ubuntu.vmx`）。
3. 点击「刷新状态」查看运行中虚拟机数量与列表状态。
4. 对单个虚拟机执行「启动 / 停止」（停止支持软关机/硬关机）。

## 开发

- 前端类型检查：`pnpm exec tsc --noEmit`
- Rust 检查：`cd src-tauri; cargo check`
