const { app, BrowserWindow, session, ipcMain } = require('electron');
const { spawn } = require('child_process');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100');

let mainWindow;
let isAlwaysOnTop = false;
let keyWatcherProc = null;

function startGlobalKeyPoller() {
  if (process.platform !== 'win32') return;

  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinKey {
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
}
"@
$vk = 86
$prev = $false
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  if ([Console]::KeyAvailable) {
    $line = [Console]::ReadLine()
    if ($line -match '^VK:(\\d+)$') {
      $vk = [int]$Matches[1]
      $prev = $false
    }
  }
  if ($vk -gt 0) {
    $state = ([WinKey]::GetAsyncKeyState($vk) -band 0x8000) -ne 0
    if ($state -ne $prev) {
      $prev = $state
      if ($state) { Write-Output "DOWN" } else { Write-Output "UP" }
    }
  }
  Start-Sleep -Milliseconds 20
}
`;

  try {
    keyWatcherProc = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-Command', psScript
    ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });

    keyWatcherProc.stdout.on('data', (chunk) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const lines = chunk.toString().split(/\r?\n/);
      lines.forEach(l => {
        const cmd = l.trim();
        if (cmd === 'DOWN') {
          mainWindow.webContents.send('global-bind-state', true);
        } else if (cmd === 'UP') {
          mainWindow.webContents.send('global-bind-state', false);
        }
      });
    });
  } catch (e) {}
}

function createWindow() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  session.defaultSession.setPermissionCheckHandler(() => {
    return true;
  });

  mainWindow = new BrowserWindow({
    width: 410,
    height: 610,
    minWidth: 360,
    minHeight: 520,
    frame: false,
    backgroundColor: '#F4F3EE',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('index.html');
  startGlobalKeyPoller();
}

ipcMain.on('set-bind-vk', (event, vkCode) => {
  if (keyWatcherProc && keyWatcherProc.stdin && !keyWatcherProc.Killed) {
    try {
      keyWatcherProc.stdin.write('VK:' + Number(vkCode) + '\n');
    } catch (e) {}
  }
});

ipcMain.on('win-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('win-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('win-toggle-top', () => {
  if (!mainWindow) return false;
  isAlwaysOnTop = !isAlwaysOnTop;
  mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'screen-saver');
  return isAlwaysOnTop;
});

app.whenReady().then(createWindow);

app.on('will-quit', () => {
  if (keyWatcherProc) {
    try { keyWatcherProc.kill(); } catch (e) {}
  }
});

app.on('window-all-closed', () => {
  app.quit();
});