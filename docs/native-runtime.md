# Running the runtime on your own machine: Linux, macOS, Windows

The Docker image is the easy path and covers browser fixes and Linux desktop applications inside the
container. When the thing your agents get stuck in lives on a real machine, a Windows ERP client, a
Mac-only tool, a Citrix session, run the runtime natively on that machine instead. Same tunnel, same
fix page, same compiler; only the desktop driver changes, and it is chosen by the operating system.

| Platform | Browser fixes | Desktop fixes | How the desktop is driven |
|---|---|---|---|
| Linux container (default) | yes | yes, Linux apps in the container | Xvfb + xdotool |
| Linux desktop, native | yes | yes | your X11 session + xdotool |
| macOS, native | yes | yes | CoreGraphics events, `screencapture` |
| Windows, native | yes | yes | user32 through one PowerShell |

The live picture a fixer sees is published by Chromium itself on every platform, so video needs no
extra software anywhere.

## Install

1. [Bun](https://bun.sh) 1.3 or newer.
2. From the repository: `cd agent-computer && bun install && bunx playwright install chromium`.
3. Set the environment and start:

```sh
DOUBLEOH_URL=https://api.doubleoh.ai \
DOUBLEOH_API_KEY=oo_live_... \
COMPUTER_ID=finance-pc-1 \
COMPUTER_TOKEN=$(openssl rand -hex 24) \
WORKSPACE_DIR=$HOME/.doubleoh/workspace PROFILES_DIR=$HOME/.doubleoh/profiles \
bun run start
```

Windows, PowerShell:

```powershell
$env:DOUBLEOH_URL="https://api.doubleoh.ai"; $env:DOUBLEOH_API_KEY="oo_live_..."; $env:COMPUTER_ID="finance-pc-1"
$env:COMPUTER_TOKEN=[guid]::NewGuid().ToString("N"); $env:WORKSPACE_DIR="$HOME\.doubleoh\workspace"; $env:PROFILES_DIR="$HOME\.doubleoh\profiles"
bun run start
```

`COMPUTER_TOKEN` is the secret the runtime's own local API requires; nothing else ever needs to know it.
`WORKSPACE_DIR` and `PROFILES_DIR` default to the container's `/workspace` and `/profiles`, which do not
exist on a laptop, so they are set explicitly here.

The runtime opens one outbound connection to DoubleOh and keeps it. Nothing listens on your network.
The portal lists the machine under Runtimes within a few seconds, and your agent passes
`computerId: "finance-pc-1"` when it asks for a fix there.

## Permissions

**macOS** asks twice, once each, for the app that launched the runtime (Terminal, iTerm, VS Code, or
whatever runs it as a service):

- Screen Recording, for the desktop capture and for Chromium's own screen share. Without it frames
  come back black and the runtime says so.
- Accessibility, for clicks and keys. Without it a click does nothing and the runtime says so.

Both are under System Settings, Privacy & Security. Restart the runtime after granting. The input
helper is compiled once from `src/desktop-drivers/macinput.swift` on first use and cached in
`~/.doubleoh/`; that needs the Xcode command line tools (`xcode-select --install`). Without them the
runtime falls back to `cliclick` (`brew install cliclick`) for pointer and text, and cannot scroll.

**Windows** needs nothing beyond PowerShell 5.1, which every Windows 10 and 11 has. Run the runtime in
the same user session as the applications it should drive; a service session cannot see the desktop.
On a scaled display (125%, 150%) coordinates and capture share the same scaled space, so clicks land.
If your organisation blocks PowerShell scripts, the runtime still runs `powershell.exe -ExecutionPolicy
Bypass` for its own child only; nothing is written to disk.

**Linux desktop** needs `xdotool` and ImageMagick (`import`), and `DISPLAY` set to your session.

## Which surface a fixer gets

The fix page offers two surfaces: the browser page, driven through Chromium's protocol, and the
desktop, driven through the platform. Browser fixes stay on the page surface everywhere; it is faster
and knows the page. Desktop is for when the stuck thing is not a page.

## Choosing a monitor

Set `DOUBLEOH_DISPLAY=2` to drive the second monitor, `3` the third. Numbering is the primary first,
then left to right. Clicks are offset into that monitor automatically. Unset means the primary.

## Linux without X11 (Wayland)

Detected from `XDG_SESSION_TYPE=wayland`. Capture uses the first of `grim` (sway, Hyprland),
`gnome-screenshot` (GNOME) or `spectacle` (KDE) that is installed. Input uses `ydotool`, which needs
its daemon `ydotoold` running and this user allowed on `/dev/uinput`; without it `wtype` still types
and presses keys, and clicking is refused with the exact package to install. X11 applications under
XWayland can also use the X11 driver: set `DOUBLEOH_DESKTOP_DRIVER=x11`.

## What has been verified where

| | Verified | How |
|---|---|---|
| Linux container | fully, in production and against a real app | hosted fixes on prod every day; in a fresh image, xfce4-terminal clicked into, a shell command typed and run through the X11 driver, output file verified |
| macOS native | fully, on a Mac, against real apps | runtime tunnelled to a server and the desktop pulled through the server's fix route; Terminal.app: clicked into, a command with accents, quotes, `&`, `#`, `$` and parentheses typed and executed, output file verified; TextEdit: text typed and read back (its autocorrect rewrote two words, the app's doing, not the driver's); Chromium window: click, unicode typing, Enter and scroll read back from the page; Calculator (RPN mode): 100 Enter 3 * gave 300, digits, Enter and shifted operators all through the driver, read from screenshots |
| Windows native | protocol only | the exact PowerShell script runs under pwsh with the Windows calls faked (`tests/win32-protocol.test.ts`); the user32 and System.Drawing calls are per Microsoft's documentation and await a first run on a real PC. `windows/bootstrap.ps1` sets a PC up as a runtime in one command, as an interactive logon task, which is what capture and input need |
| Wayland | capture and typing, on headless sway | `test-rigs/wayland`: grim capture (PNG converted when grim lacks JPEG), a shell command with accents and shifted symbols typed into a real foot terminal through the virtual-keyboard path and executed. Clicking untested: uinput needs a real session's libinput and udev |

## How typing reaches apps on macOS

Two kinds of app, one sequence that satisfies both. Apps that read characters (Terminal, TextEdit, a
browser) take whatever the event says; apps that read the physical key and its modifier flags
(Calculator, games, anything on NSEvent key codes) need the real key with Shift on it. The helper maps
each character through the current keyboard layout, presses Shift as its own key event, sends the key
with the Shift flag set, releases Shift, and lets the system derive the character. Characters the
layout cannot produce still go as unicode events, which character-reading apps accept.

## Known limits


- The runtime drives the machine it runs on. A Citrix or RDP session is driven as a window on that
  machine, which works, but the remote side sees only synthetic input; that is how every remote tool
  works and not something to fix.
- Wayland scaling: `ydotool` moves in device pixels while some compositors report logical ones. If
  clicks land short on a scaled display, run the session unscaled or use the container.
