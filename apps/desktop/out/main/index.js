"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const node_fs = require("node:fs");
const path = require("node:path");
const log = require("electron-log/main");
const promises = require("node:fs/promises");
const node_child_process = require("node:child_process");
const node_module = require("node:module");
const browsers = require("@puppeteer/browsers");
function createAppLogger(paths) {
  log.transports.file.resolvePathFn = () => path.join(paths.logsDir(), "main.log");
  return {
    log(scope, level, message) {
      log[level](`[${scope}] ${message}`);
    },
    attachStream(profileId, readable) {
      const logPath = path.join(paths.logsDir(), `browser-${profileId}.log`);
      readable.on("data", (chunk) => {
        node_fs.appendFileSync(logPath, chunk);
      });
    }
  };
}
class AppPaths {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
  }
  profilesRoot() {
    return path.join(this.userDataDir, "profiles");
  }
  logsDir() {
    return path.join(this.userDataDir, "logs");
  }
  async ensure() {
    await promises.mkdir(this.profilesRoot(), { recursive: true });
    await promises.mkdir(this.logsDir(), { recursive: true });
  }
}
function buildArgv(opts) {
  const argv = [
    `--user-data-dir=${opts.userDataDir}`,
    `--load-extension=${opts.extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-crash-restore-bubble"
  ];
  if (opts.debugPipe) {
    argv.push("--remote-debugging-pipe");
  }
  if (opts.startUrl) {
    argv.push(opts.startUrl);
  }
  return argv;
}
class BrowserSupervisor {
  constructor(deps) {
    this.deps = deps;
    this.listeners = /* @__PURE__ */ new Set();
    this.statusValue = "idle";
    this.spawnBrowser = deps.spawnBrowser ?? defaultSpawnBrowser;
    this.focusExisting = deps.focusExisting ?? defaultFocusExisting;
  }
  async launch(profileId = "default") {
    if (this.statusValue === "launching") return;
    if (this.statusValue === "running") {
      if (this.currentBinary && this.currentArgv) {
        await this.focusExisting(this.currentBinary, this.currentArgv);
      }
      return;
    }
    const userDataDir = await this.deps.profiles.ensureProfile(profileId);
    const binary = this.deps.resources.browserBinary();
    const argv = buildArgv({
      userDataDir,
      extensionDir: this.deps.resources.extensionDir()
    });
    this.setStatus("launching");
    let child;
    try {
      child = this.spawnBrowser(binary, argv);
    } catch (error) {
      this.clearCurrentProcess();
      this.setStatus("error");
      throw error;
    }
    this.child = child;
    this.currentBinary = binary;
    this.currentArgv = [...argv];
    this.attachBrowserLogs(profileId, child);
    this.bindChildEvents(child);
  }
  status() {
    return this.statusValue;
  }
  onStatusChange(cb) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  async requestShutdown() {
    const child = this.child;
    if (!child) return;
    await new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(settle, 2e3);
      child.on("exit", settle);
      child.kill();
    });
  }
  bindChildEvents(child) {
    child.on("spawn", () => {
      if (this.child === child) {
        this.setStatus("running");
      }
    });
    child.on("error", (error) => {
      if (this.child !== child) return;
      this.deps.logger.log("BrowserSupervisor", "error", error.message);
      this.clearCurrentProcess();
      this.setStatus("error");
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.clearCurrentProcess();
      this.setStatus((code === 0 || code === null) && signal === null ? "idle" : "error");
    });
  }
  attachBrowserLogs(profileId, child) {
    if (child.stdout) {
      this.deps.logger.attachStream(profileId, child.stdout);
    }
    if (child.stderr) {
      this.deps.logger.attachStream(profileId, child.stderr);
    }
  }
  clearCurrentProcess() {
    this.child = void 0;
    this.currentBinary = void 0;
    this.currentArgv = void 0;
  }
  setStatus(next) {
    if (next === this.statusValue) return;
    this.statusValue = next;
    this.listeners.forEach((listener) => {
      listener(next);
    });
  }
}
function defaultSpawnBrowser(binary, argv) {
  return node_child_process.spawn(binary, argv, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
}
function defaultFocusExisting(binary, argv) {
  const process2 = node_child_process.spawn(binary, argv, { detached: true, stdio: "ignore" });
  process2.unref();
}
const require$1 = node_module.createRequire(require("url").pathToFileURL(__filename).href);
const lock = require$1("../../browser.lock.json");
function resolveBrowserPlatform(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "arm64") return browsers.BrowserPlatform.MAC_ARM;
  if (platform === "darwin" && arch === "x64") return browsers.BrowserPlatform.MAC;
  if (platform === "win32" && arch === "x64") return browsers.BrowserPlatform.WIN64;
  throw new Error(`Unsupported browser platform: ${platform}/${arch}`);
}
function createBrowserResources(options) {
  const platform = resolveBrowserPlatform(options.platform, options.arch);
  return {
    browserBinary() {
      if (options.isPackaged) {
        if (!options.resourcesPath) {
          throw new Error("resourcesPath is required in packaged mode");
        }
        return path.join(
          options.resourcesPath,
          "browser",
          browsers.computeExecutablePath({
            cacheDir: null,
            browser: browsers.Browser.CHROME,
            buildId: lock.version,
            platform
          })
        );
      }
      return browsers.computeExecutablePath({
        cacheDir: path.join(options.repoRoot, ".browsers"),
        browser: browsers.Browser.CHROME,
        buildId: lock.version,
        platform
      });
    },
    extensionDir() {
      if (options.isPackaged) {
        if (!options.resourcesPath) {
          throw new Error("resourcesPath is required in packaged mode");
        }
        return path.join(options.resourcesPath, "extension");
      }
      return path.join(options.repoRoot, "apps", "extension", ".output", "chrome-mv3");
    },
    browserVersion() {
      return lock.version;
    }
  };
}
function registerDesktopBridge(options) {
  options.ipcMain.handle("browser:launch", async () => {
    try {
      await options.supervisor.launch();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toUserSafeMessage(error) };
    }
  });
  options.ipcMain.handle("browser:getStatus", async () => {
    return options.supervisor.status();
  });
  options.ipcMain.handle("app:getVersions", async () => {
    return {
      app: options.getAppVersion(),
      browser: options.resources.browserVersion(),
      extension: readExtensionVersion(options.resources.extensionDir())
    };
  });
  return options.supervisor.onStatusChange(options.sendStatus);
}
function readExtensionVersion(extensionDir) {
  try {
    const manifestPath = path.join(extensionDir, "manifest.json");
    const manifest = JSON.parse(node_fs.readFileSync(manifestPath, "utf8"));
    if (typeof manifest.version === "string" && manifest.version.length > 0) {
      return manifest.version;
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}
function toUserSafeMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return "Unknown launch error";
}
const PROFILE_ID = /^[a-zA-Z0-9_-]+$/;
class ProfileStore {
  constructor(paths) {
    this.paths = paths;
  }
  async ensureProfile(id = "default") {
    const dir = this.profileDir(id);
    await promises.mkdir(dir, { recursive: true });
    return dir;
  }
  listProfiles() {
    return node_fs.readdirSync(this.paths.profilesRoot(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  }
  profileDir(id) {
    if (!PROFILE_ID.test(id)) {
      throw new Error(`Invalid profile id: ${id}`);
    }
    return path.join(this.paths.profilesRoot(), id);
  }
}
async function handleBrowserRunningClose(deps) {
  const status = deps.status();
  if (status === "idle" || status === "error") {
    return "allow";
  }
  const { response } = await deps.showMessageBox();
  if (response === 1) {
    await deps.requestShutdown();
  }
  return "allow";
}
async function startMainBootstrap() {
  const electron = await import("electron");
  await electron.app.whenReady();
  const paths = new AppPaths(electron.app.getPath("userData"));
  await paths.ensure();
  const logger = createAppLogger(paths);
  const resources = createBrowserResources({
    repoRoot: resolveRepoRoot(electron.app.getAppPath()),
    isPackaged: electron.app.isPackaged,
    resourcesPath: process.resourcesPath
  });
  const profiles = new ProfileStore(paths);
  const supervisor = new BrowserSupervisor({ resources, profiles, logger });
  let currentWindow;
  registerDesktopBridge({
    ipcMain: electron.ipcMain,
    supervisor,
    resources,
    getAppVersion: () => electron.app.getVersion(),
    sendStatus: (status) => currentWindow?.webContents.send("browser:status-changed", status)
  });
  const createWindow = () => {
    currentWindow = createControlWindow(electron, supervisor);
    currentWindow.on("closed", () => {
      if (currentWindow?.isDestroyed()) {
        currentWindow = void 0;
      }
    });
  };
  createWindow();
  electron.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      electron.app.quit();
    }
  });
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
function resolveRepoRoot(start) {
  let current = start;
  while (true) {
    if (node_fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}
function createControlWindow(electron, supervisor) {
  const win = new electron.BrowserWindow({
    width: 480,
    height: 360,
    resizable: true,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  let allowClose = false;
  win.on("close", (event) => {
    if (allowClose || supervisor.status() === "idle" || supervisor.status() === "error") {
      return;
    }
    event.preventDefault();
    void handleBrowserRunningClose({
      status: () => supervisor.status(),
      showMessageBox: () => electron.dialog.showMessageBox(win, {
        type: "question",
        title: "浏览器仍在运行",
        message: "浏览器仍在运行",
        detail: "可以只退出问学，也可以一并关闭当前问学浏览器。",
        buttons: ["仅退出问学", "一并关闭浏览器"],
        defaultId: 0,
        cancelId: 0
      }),
      requestShutdown: () => supervisor.requestShutdown()
    }).then((decision) => {
      if (decision === "allow" && !win.isDestroyed()) {
        allowClose = true;
        win.close();
      }
    });
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
startMainBootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
