const { app, BrowserWindow, session } = require('electron');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1100, minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d0d0f',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    show: false
  });

  // Modificar el Origin del WebSocket para que Apex lo acepte
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if(details.url.includes('apex-timing.com')) {
      details.requestHeaders['Origin'] = 'https://live.apex-timing.com';
      details.requestHeaders['Referer'] = 'https://live.apex-timing.com/rkc/';
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  win.loadFile('src/index.html');
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if(process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if(BrowserWindow.getAllWindows().length === 0) createWindow(); });
