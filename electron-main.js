const path = require("node:path");
const { app, BrowserWindow, dialog, session, shell } = require("electron");

app.setName("iEast Controller");
app.setAppUserModelId("dk.knas.ieastcontroller");
app.setPath("userData", path.join(app.getPath("appData"), "ieast-controller"));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let serverApi = null;
let shutdownStarted = false;

async function createApplication() {
  const port = process.env.IEAST_PORT || "3000";
  const origin = `http://127.0.0.1:${port}`;

  process.env.HOST = "127.0.0.1";
  process.env.PORT = port;
  process.env.STATE_DIR = path.join(app.getPath("userData"), "state");
  process.env.SPOTIFY_REDIRECT_URI = `${origin}/api/spotify/callback`;

  serverApi = require("./server");
  try {
    await serverApi.startServer();
  } catch (error) {
    const message = error.code === "EADDRINUSE"
      ? `Port ${port} er allerede i brug. Luk den anden iEast Controller eller vælg en anden IEAST_PORT.`
      : error.message;
    dialog.showErrorBox("iEast Controller kunne ikke starte", message);
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    show: false,
    icon: path.join(__dirname, "public", "ieast-controller.svg"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const target = new URL(targetUrl);
    if (target.origin === origin && target.pathname !== "/api/spotify/login") return;
    event.preventDefault();
    if (/^https?:$/.test(target.protocol)) shell.openExternal(targetUrl);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  await mainWindow.loadURL(`${origin}/`);
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(createApplication).catch((error) => {
    dialog.showErrorBox("iEast Controller kunne ikke starte", error.message);
    app.quit();
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (shutdownStarted || !serverApi) return;
    event.preventDefault();
    shutdownStarted = true;
    serverApi.stopServer().finally(() => app.quit());
  });
}
