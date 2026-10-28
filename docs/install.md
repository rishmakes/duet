# Install Duet

Duet is free. It is not signed with a paid developer certificate yet, so your computer will ask you to confirm the first time. That is normal for a young free app, and it takes ten seconds.

Download from the [Releases page](https://github.com/rishmakes/duet/releases).

## Mac

1. Download the `.dmg` that matches your Mac.
   - Apple Silicon (M1, M2, M3, M4): the file with `aarch64` in its name.
   - Older Intel Macs: the file with `x64` in its name.
   - Not sure? Apple menu, then About This Mac. If it says "Chip", pick Apple Silicon.
2. Open the `.dmg` and drag **Duet** into **Applications**.
3. Open Duet from Applications. macOS will say it cannot check the app for malware. Click **Done**.
4. Open **System Settings**, then **Privacy & Security**. Scroll down to the message about Duet and click **Open Anyway**. Confirm with your password.
5. Duet opens. You will not be asked again.

If macOS says Duet is "damaged and can't be opened", that is the same warning in different words. Open the Terminal app and run this once, then open Duet again:

```sh
xattr -dr com.apple.quarantine /Applications/Duet.app
```

Duet needs macOS 13 or newer.

## Windows

1. Download the `.exe` setup file (or the `.msi`).
2. Open it. Windows may show **Windows protected your PC**. Click **More info**, then **Run anyway**.
3. Follow the installer. Duet appears in your Start menu.

Windows builds are new. If something is broken, please open an issue and say what Windows version you use.

## Linux

Linux builds are new and less tested than Mac. Pick one:

- **Ubuntu, Debian, Mint, Pop!_OS:** the `.deb` file. Open it in the Software app, or run `sudo apt install ./Duet_*_amd64.deb` in a terminal. ffmpeg is installed with it.
- **Fedora, openSUSE:** the `.rpm` file. Open it, or run `sudo dnf install ./Duet-*.x86_64.rpm`. ffmpeg is installed with it.
- **Any other Linux:** the `.AppImage` file. Make it runnable (right click, Properties, Allow executing, or `chmod +x Duet_*.AppImage`), then open it. It needs ffmpeg on the system: `sudo apt install ffmpeg` or your system's equivalent.

If something is broken, please open an issue and say which Linux you use.

## Video and motion

On Mac and Windows Duet carries its own ffmpeg (LGPL), so video playback, scrubbing and exports work straight away. On Linux the system's ffmpeg is used; the `.deb` and `.rpm` install it for you. Credits and licence details are in [docs/third-party.md](third-party.md).

## Connect your AI (optional)

Duet works without an AI. For the chat, install [Claude Code](https://claude.com/claude-code) or Antigravity (`agy`) and sign in once in a terminal. Then open Duet. The chat finds them by itself, and a switch at the top of the chat lets you choose. The first time you chat with Antigravity, Duet adds itself to Antigravity's list of connections (named `duet`). If Antigravity cannot be joined automatically, Duet explains why. You can run this command in a terminal once:

```sh
agy mcp add duet /Applications/Duet.app --mcp-bridge
```

Codex and OpenCode are planned.

## Your projects

A project is one file that ends in `.duet`, with your design, your pictures and its whole history inside. Open projects show as tabs in their own row at the top, like a browser. A home button opens all your projects, `+` starts a new design, and `×` closes a tab. Duet always starts on your projects with your last one a click away, and saves automatically as you work, so there is no Save button to remember.
