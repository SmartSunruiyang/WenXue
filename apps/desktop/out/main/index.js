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
const fs = require("node:fs");
const path = require("node:path");
const log = require("electron-log/main");
const fs$1 = require("node:fs/promises");
const childProcess = require("node:child_process");
const node_module = require("node:module");
require("node:events");
const os = require("node:os");
require("node:readline");
require("node:http");
require("node:https");
require("node:url");
const node_util = require("node:util");
require("node:assert");
require("node:stream");
require("node:process");
function createAppLogger(paths) {
  log.transports.file.resolvePathFn = () => path.join(paths.logsDir(), "main.log");
  return {
    log(scope, level, message) {
      log[level](`[${scope}] ${message}`);
    },
    attachStream(profileId, readable) {
      const logPath = path.join(paths.logsDir(), `browser-${profileId}.log`);
      readable.on("data", (chunk) => {
        fs.appendFileSync(logPath, chunk);
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
    await fs$1.mkdir(this.profilesRoot(), { recursive: true });
    await fs$1.mkdir(this.logsDir(), { recursive: true });
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
      this.shutdownRequestedFor = child;
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
      const wasRequestedShutdown = this.shutdownRequestedFor === child;
      const wasNormalExit = (code === 0 || code === null) && signal === null;
      this.clearCurrentProcess();
      this.setStatus(wasRequestedShutdown || wasNormalExit ? "idle" : "error");
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
    this.shutdownRequestedFor = void 0;
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
  return childProcess.spawn(binary, argv, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
}
function defaultFocusExisting(binary, argv) {
  const process2 = childProcess.spawn(binary, argv, { detached: true, stdio: "ignore" });
  process2.unref();
}
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var Browser;
(function(Browser2) {
  Browser2["CHROME"] = "chrome";
  Browser2["CHROMEHEADLESSSHELL"] = "chrome-headless-shell";
  Browser2["CHROMIUM"] = "chromium";
  Browser2["FIREFOX"] = "firefox";
  Browser2["CHROMEDRIVER"] = "chromedriver";
})(Browser || (Browser = {}));
var BrowserPlatform;
(function(BrowserPlatform2) {
  BrowserPlatform2["LINUX"] = "linux";
  BrowserPlatform2["LINUX_ARM"] = "linux_arm";
  BrowserPlatform2["MAC"] = "mac";
  BrowserPlatform2["MAC_ARM"] = "mac_arm";
  BrowserPlatform2["WIN32"] = "win32";
  BrowserPlatform2["WIN64"] = "win64";
})(BrowserPlatform || (BrowserPlatform = {}));
var BrowserTag;
(function(BrowserTag2) {
  BrowserTag2["CANARY"] = "canary";
  BrowserTag2["NIGHTLY"] = "nightly";
  BrowserTag2["BETA"] = "beta";
  BrowserTag2["DEV"] = "dev";
  BrowserTag2["DEVEDITION"] = "devedition";
  BrowserTag2["STABLE"] = "stable";
  BrowserTag2["ESR"] = "esr";
  BrowserTag2["LATEST"] = "latest";
})(BrowserTag || (BrowserTag = {}));
var ChromeReleaseChannel;
(function(ChromeReleaseChannel2) {
  ChromeReleaseChannel2["STABLE"] = "stable";
  ChromeReleaseChannel2["DEV"] = "dev";
  ChromeReleaseChannel2["CANARY"] = "canary";
  ChromeReleaseChannel2["BETA"] = "beta";
})(ChromeReleaseChannel || (ChromeReleaseChannel = {}));
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
function folder$3(platform) {
  switch (platform) {
    case BrowserPlatform.LINUX_ARM:
    case BrowserPlatform.LINUX:
      return "linux64";
    case BrowserPlatform.MAC_ARM:
      return "mac-arm64";
    case BrowserPlatform.MAC:
      return "mac-x64";
    case BrowserPlatform.WIN32:
      return "win32";
    case BrowserPlatform.WIN64:
      return "win64";
  }
}
function resolveDownloadUrl$4(platform, buildId, baseUrl = "https://storage.googleapis.com/chrome-for-testing-public") {
  return `${baseUrl}/${resolveDownloadPath$4(platform, buildId).join("/")}`;
}
function resolveDownloadPath$4(platform, buildId) {
  return [buildId, folder$3(platform), `chrome-${folder$3(platform)}.zip`];
}
function relativeExecutablePath$4(platform, _buildId) {
  switch (platform) {
    case BrowserPlatform.MAC:
    case BrowserPlatform.MAC_ARM:
      return path.join("chrome-" + folder$3(platform), "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
    case BrowserPlatform.LINUX_ARM:
    case BrowserPlatform.LINUX:
      return path.join("chrome-linux64", "chrome");
    case BrowserPlatform.WIN32:
    case BrowserPlatform.WIN64:
      return path.join("chrome-" + folder$3(platform), "chrome.exe");
  }
}
function compareVersions$2(a, b) {
  const cleanA = a.trim();
  const cleanB = b.trim();
  const versionRegex = /^\d+(?:\.\d+){0,3}$/;
  if (!versionRegex.test(cleanA)) {
    throw new Error(`Version ${a} is not a valid Chrome version`);
  }
  if (!versionRegex.test(cleanB)) {
    throw new Error(`Version ${b} is not a valid Chrome version`);
  }
  const aParts = cleanA.split(".").map(Number);
  const bParts = cleanB.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const aPart = aParts[i] ?? 0;
    const bPart = bParts[i] ?? 0;
    if (aPart > bPart) {
      return 1;
    }
    if (aPart < bPart) {
      return -1;
    }
  }
  return 0;
}
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
function folder$2(platform) {
  switch (platform) {
    case BrowserPlatform.LINUX_ARM:
    case BrowserPlatform.LINUX:
      return "linux64";
    case BrowserPlatform.MAC_ARM:
      return "mac-arm64";
    case BrowserPlatform.MAC:
      return "mac-x64";
    case BrowserPlatform.WIN32:
      return "win32";
    case BrowserPlatform.WIN64:
      return "win64";
  }
}
function resolveDownloadUrl$3(platform, buildId, baseUrl = "https://storage.googleapis.com/chrome-for-testing-public") {
  return `${baseUrl}/${resolveDownloadPath$3(platform, buildId).join("/")}`;
}
function resolveDownloadPath$3(platform, buildId) {
  return [
    buildId,
    folder$2(platform),
    `chrome-headless-shell-${folder$2(platform)}.zip`
  ];
}
function relativeExecutablePath$3(platform, _buildId) {
  switch (platform) {
    case BrowserPlatform.MAC:
    case BrowserPlatform.MAC_ARM:
      return path.join("chrome-headless-shell-" + folder$2(platform), "chrome-headless-shell");
    case BrowserPlatform.LINUX_ARM:
    case BrowserPlatform.LINUX:
      return path.join("chrome-headless-shell-linux64", "chrome-headless-shell");
    case BrowserPlatform.WIN32:
    case BrowserPlatform.WIN64:
      return path.join("chrome-headless-shell-" + folder$2(platform), "chrome-headless-shell.exe");
  }
}
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
function folder$1(platform) {
  switch (platform) {
    case BrowserPlatform.LINUX_ARM:
    case BrowserPlatform.LINUX:
      return "linux64";
    case BrowserPlatform.MAC_ARM:
      return "mac-arm64";
    case BrowserPlatform.MAC:
      return "mac-x64";
    case BrowserPlatform.WIN32:
      return "win32";
    case BrowserPlatform.WIN64:
      return "win64";
  }
}
function resolveDownloadUrl$2(platform, buildId, baseUrl = "https://storage.googleapis.com/chrome-for-testing-public") {
  return `${baseUrl}/${resolveDownloadPath$2(platform, buildId).join("/")}`;
}
function resolveDownloadPath$2(platform, buildId) {
  return [buildId, folder$1(platform), `chromedriver-${folder$1(platform)}.zip`];
}
function relativeExecutablePath$2(platform, _buildId) {
  switch (platform) {
    case BrowserPlatform.MAC:
    case BrowserPlatform.MAC_ARM:
      return path.join("chromedriver-" + folder$1(platform), "chromedriver");
    case BrowserPlatform.LINUX_ARM:
    case BrowserPlatform.LINUX:
      return path.join("chromedriver-linux64", "chromedriver");
    case BrowserPlatform.WIN32:
    case BrowserPlatform.WIN64:
      return path.join("chromedriver-" + folder$1(platform), "chromedriver.exe");
  }
}
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
function archive$1(platform, buildId) {
  switch (platform) {
    case BrowserPlatform.LINUX_ARM:
    case BrowserPlatform.LINUX:
      return "chrome-linux";
    case BrowserPlatform.MAC_ARM:
    case BrowserPlatform.MAC:
      return "chrome-mac";
    case BrowserPlatform.WIN32:
    case BrowserPlatform.WIN64:
      return parseInt(buildId, 10) > 591479 ? "chrome-win" : "chrome-win32";
  }
}
function folder(platform) {
  switch (platform) {
    case BrowserPlatform.LINUX_ARM:
    case BrowserPlatform.LINUX:
      return "Linux_x64";
    case BrowserPlatform.MAC_ARM:
      return "Mac_Arm";
    case BrowserPlatform.MAC:
      return "Mac";
    case BrowserPlatform.WIN32:
      return "Win";
    case BrowserPlatform.WIN64:
      return "Win_x64";
  }
}
function resolveDownloadUrl$1(platform, buildId, baseUrl = "https://storage.googleapis.com/chromium-browser-snapshots") {
  return `${baseUrl}/${resolveDownloadPath$1(platform, buildId).join("/")}`;
}
function resolveDownloadPath$1(platform, buildId) {
  return [folder(platform), buildId, `${archive$1(platform, buildId)}.zip`];
}
function relativeExecutablePath$1(platform, _buildId) {
  switch (platform) {
    case BrowserPlatform.MAC:
    case BrowserPlatform.MAC_ARM:
      return path.join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
    case BrowserPlatform.LINUX_ARM:
    case BrowserPlatform.LINUX:
      return path.join("chrome-linux", "chrome");
    case BrowserPlatform.WIN32:
    case BrowserPlatform.WIN64:
      return path.join("chrome-win", "chrome.exe");
  }
}
function compareVersions$1(a, b) {
  return Number(a) - Number(b);
}
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
function getFormat(buildId) {
  const majorVersion = Number(buildId.split(".").shift());
  return majorVersion >= 135 ? "xz" : "bz2";
}
function archiveNightly(platform, buildId) {
  switch (platform) {
    case BrowserPlatform.LINUX:
      return `firefox-${buildId}.en-US.linux-x86_64.tar.${getFormat(buildId)}`;
    case BrowserPlatform.LINUX_ARM:
      return `firefox-${buildId}.en-US.linux-aarch64.tar.${getFormat(buildId)}`;
    case BrowserPlatform.MAC_ARM:
    case BrowserPlatform.MAC:
      return `firefox-${buildId}.en-US.mac.dmg`;
    case BrowserPlatform.WIN32:
    case BrowserPlatform.WIN64:
      return `firefox-${buildId}.en-US.${platform}.zip`;
  }
}
function archive(platform, buildId) {
  switch (platform) {
    case BrowserPlatform.LINUX_ARM:
    case BrowserPlatform.LINUX:
      return `firefox-${buildId}.tar.${getFormat(buildId)}`;
    case BrowserPlatform.MAC_ARM:
    case BrowserPlatform.MAC:
      return `Firefox ${buildId}.dmg`;
    case BrowserPlatform.WIN32:
    case BrowserPlatform.WIN64:
      return `Firefox Setup ${buildId}.exe`;
  }
}
function platformName(platform) {
  switch (platform) {
    case BrowserPlatform.LINUX:
      return `linux-x86_64`;
    case BrowserPlatform.LINUX_ARM:
      return `linux-aarch64`;
    case BrowserPlatform.MAC_ARM:
    case BrowserPlatform.MAC:
      return `mac`;
    case BrowserPlatform.WIN32:
    case BrowserPlatform.WIN64:
      return platform;
  }
}
function parseBuildId(buildId) {
  for (const value of Object.values(FirefoxChannel)) {
    if (buildId.startsWith(value + "_")) {
      buildId = buildId.substring(value.length + 1);
      return [value, buildId];
    }
  }
  return [FirefoxChannel.NIGHTLY, buildId];
}
function resolveDownloadUrl(platform, buildId, baseUrl) {
  const [channel] = parseBuildId(buildId);
  switch (channel) {
    case FirefoxChannel.NIGHTLY:
      baseUrl ??= "https://archive.mozilla.org/pub/firefox/nightly/latest-mozilla-central";
      break;
    case FirefoxChannel.DEVEDITION:
      baseUrl ??= "https://archive.mozilla.org/pub/devedition/releases";
      break;
    case FirefoxChannel.BETA:
    case FirefoxChannel.STABLE:
    case FirefoxChannel.ESR:
      baseUrl ??= "https://archive.mozilla.org/pub/firefox/releases";
      break;
  }
  return `${baseUrl}/${resolveDownloadPath(platform, buildId).join("/")}`;
}
function resolveDownloadPath(platform, buildId) {
  const [channel, resolvedBuildId] = parseBuildId(buildId);
  switch (channel) {
    case FirefoxChannel.NIGHTLY:
      return [archiveNightly(platform, resolvedBuildId)];
    case FirefoxChannel.DEVEDITION:
    case FirefoxChannel.BETA:
    case FirefoxChannel.STABLE:
    case FirefoxChannel.ESR:
      return [
        resolvedBuildId,
        platformName(platform),
        "en-US",
        archive(platform, resolvedBuildId)
      ];
  }
}
function relativeExecutablePath(platform, buildId) {
  const [channel] = parseBuildId(buildId);
  switch (channel) {
    case FirefoxChannel.NIGHTLY:
      switch (platform) {
        case BrowserPlatform.MAC_ARM:
        case BrowserPlatform.MAC:
          return path.join("Firefox Nightly.app", "Contents", "MacOS", "firefox");
        case BrowserPlatform.LINUX_ARM:
        case BrowserPlatform.LINUX:
          return path.join("firefox", "firefox");
        case BrowserPlatform.WIN32:
        case BrowserPlatform.WIN64:
          return path.join("firefox", "firefox.exe");
      }
    case FirefoxChannel.BETA:
    case FirefoxChannel.DEVEDITION:
    case FirefoxChannel.ESR:
    case FirefoxChannel.STABLE:
      switch (platform) {
        case BrowserPlatform.MAC_ARM:
        case BrowserPlatform.MAC:
          return path.join("Firefox.app", "Contents", "MacOS", "firefox");
        case BrowserPlatform.LINUX_ARM:
        case BrowserPlatform.LINUX:
          return path.join("firefox", "firefox");
        case BrowserPlatform.WIN32:
        case BrowserPlatform.WIN64:
          return path.join("core", "firefox.exe");
      }
  }
}
var FirefoxChannel;
(function(FirefoxChannel2) {
  FirefoxChannel2["STABLE"] = "stable";
  FirefoxChannel2["ESR"] = "esr";
  FirefoxChannel2["DEVEDITION"] = "devedition";
  FirefoxChannel2["BETA"] = "beta";
  FirefoxChannel2["NIGHTLY"] = "nightly";
})(FirefoxChannel || (FirefoxChannel = {}));
function compareVersions(a, b) {
  return parseInt(a.replace(".", ""), 16) - parseInt(b.replace(".", ""), 16);
}
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
({
  [Browser.CHROMEDRIVER]: resolveDownloadUrl$2,
  [Browser.CHROMEHEADLESSSHELL]: resolveDownloadUrl$3,
  [Browser.CHROME]: resolveDownloadUrl$4,
  [Browser.CHROMIUM]: resolveDownloadUrl$1,
  [Browser.FIREFOX]: resolveDownloadUrl
});
({
  [Browser.CHROMEDRIVER]: resolveDownloadPath$2,
  [Browser.CHROMEHEADLESSSHELL]: resolveDownloadPath$3,
  [Browser.CHROME]: resolveDownloadPath$4,
  [Browser.CHROMIUM]: resolveDownloadPath$1,
  [Browser.FIREFOX]: resolveDownloadPath
});
const executablePathByBrowser = {
  [Browser.CHROMEDRIVER]: relativeExecutablePath$2,
  [Browser.CHROMEHEADLESSSHELL]: relativeExecutablePath$3,
  [Browser.CHROME]: relativeExecutablePath$4,
  [Browser.CHROMIUM]: relativeExecutablePath$1,
  [Browser.FIREFOX]: relativeExecutablePath
};
const versionComparators = {
  [Browser.CHROMEDRIVER]: compareVersions$2,
  [Browser.CHROMEHEADLESSSHELL]: compareVersions$2,
  [Browser.CHROME]: compareVersions$2,
  [Browser.CHROMIUM]: compareVersions$1,
  [Browser.FIREFOX]: compareVersions
};
function getVersionComparator(browser) {
  return versionComparators[browser];
}
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
const debug = (prefix) => {
  const log2 = node_util.debuglog(prefix);
  return log2.enabled ? log2 : void 0;
};
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
function detectBrowserPlatform() {
  const platform = os.platform();
  const arch = os.arch();
  switch (platform) {
    case "darwin":
      return arch === "arm64" ? BrowserPlatform.MAC_ARM : BrowserPlatform.MAC;
    case "linux":
      return arch === "arm64" ? BrowserPlatform.LINUX_ARM : BrowserPlatform.LINUX;
    case "win32":
      return arch === "x64" || // Windows 11 for ARM supports x64 emulation
      arch === "arm64" && isWindows11(os.release()) ? BrowserPlatform.WIN64 : BrowserPlatform.WIN32;
    default:
      return void 0;
  }
}
function isWindows11(version) {
  const parts = version.split(".");
  if (parts.length > 2) {
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    const patch = parseInt(parts[2], 10);
    return major > 10 || major === 10 && minor > 0 || major === 10 && minor === 0 && patch >= 22e3;
  }
  return false;
}
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
const debugCache = debug("puppeteer:browsers:cache");
class InstalledBrowser {
  browser;
  buildId;
  platform;
  executablePath;
  #cache;
  /**
   * @internal
   */
  constructor(cache, browser, buildId, platform) {
    this.#cache = cache;
    this.browser = browser;
    this.buildId = buildId;
    this.platform = platform;
    this.executablePath = cache.computeExecutablePath({
      browser,
      buildId,
      platform
    });
  }
  /**
   * Path to the root of the installation folder. Use
   * {@link computeExecutablePath} to get the path to the executable binary.
   */
  get path() {
    return this.#cache.installationDir(this.browser, this.platform, this.buildId);
  }
  readMetadata() {
    return this.#cache.readMetadata(this.browser);
  }
  writeMetadata(metadata) {
    this.#cache.writeMetadata(this.browser, metadata);
  }
}
class Cache {
  #rootDir;
  constructor(rootDir) {
    this.#rootDir = rootDir;
  }
  /**
   * @internal
   */
  get rootDir() {
    return this.#rootDir;
  }
  browserRoot(browser) {
    return path.join(this.#rootDir, browser);
  }
  metadataFile(browser) {
    return path.join(this.browserRoot(browser), ".metadata");
  }
  readMetadata(browser) {
    const metatadaPath = this.metadataFile(browser);
    if (!fs.existsSync(metatadaPath)) {
      return { aliases: {} };
    }
    const data = JSON.parse(fs.readFileSync(metatadaPath, "utf8"));
    if (typeof data !== "object") {
      throw new Error(".metadata is not an object");
    }
    return data;
  }
  writeMetadata(browser, metadata) {
    const metatadaPath = this.metadataFile(browser);
    fs.mkdirSync(path.dirname(metatadaPath), { recursive: true });
    fs.writeFileSync(metatadaPath, JSON.stringify(metadata, null, 2));
  }
  readExecutablePath(browser, platform, buildId) {
    const metadata = this.readMetadata(browser);
    const key = `${platform}-${buildId}`;
    return metadata.executablePaths?.[key] ?? null;
  }
  writeExecutablePath(browser, platform, buildId, executablePath) {
    const metadata = this.readMetadata(browser);
    if (!metadata.executablePaths) {
      metadata.executablePaths = {};
    }
    const key = `${platform}-${buildId}`;
    metadata.executablePaths[key] = executablePath;
    this.writeMetadata(browser, metadata);
  }
  resolveAlias(browser, alias) {
    const metadata = this.readMetadata(browser);
    if (alias === "latest") {
      return Object.values(metadata.aliases || {}).sort(getVersionComparator(browser)).at(-1);
    }
    return metadata.aliases[alias];
  }
  installationDir(browser, platform, buildId) {
    return path.join(this.browserRoot(browser), `${platform}-${buildId}`);
  }
  clear() {
    fs.rmSync(this.#rootDir, {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 500
    });
  }
  uninstall(browser, platform, buildId) {
    const metadata = this.readMetadata(browser);
    for (const alias of Object.keys(metadata.aliases)) {
      if (metadata.aliases[alias] === buildId) {
        delete metadata.aliases[alias];
      }
    }
    const key = `${platform}-${buildId}`;
    if (metadata.executablePaths?.[key]) {
      delete metadata.executablePaths[key];
      this.writeMetadata(browser, metadata);
    }
    fs.rmSync(this.installationDir(browser, platform, buildId), {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 500
    });
  }
  getInstalledBrowsers() {
    if (!fs.existsSync(this.#rootDir)) {
      return [];
    }
    const types = fs.readdirSync(this.#rootDir);
    const browsers = types.filter((t) => {
      return Object.values(Browser).includes(t);
    });
    return browsers.flatMap((browser) => {
      const files = fs.readdirSync(this.browserRoot(browser));
      return files.map((file) => {
        const result = parseFolderPath(path.join(this.browserRoot(browser), file));
        if (!result) {
          return null;
        }
        return new InstalledBrowser(this, browser, result.buildId, result.platform);
      }).filter((item) => {
        return item !== null;
      });
    });
  }
  computeExecutablePath(options) {
    options.platform ??= detectBrowserPlatform();
    if (!options.platform) {
      throw new Error(`Cannot download a binary for the provided platform: ${os.platform()} (${os.arch()})`);
    }
    try {
      options.buildId = this.resolveAlias(options.browser, options.buildId) ?? options.buildId;
    } catch {
      debugCache?.("could not read .metadata file for the browser");
    }
    const installationDir = this.installationDir(options.browser, options.platform, options.buildId);
    const storedExecutablePath = this.readExecutablePath(options.browser, options.platform, options.buildId);
    if (storedExecutablePath) {
      return path.join(installationDir, storedExecutablePath);
    }
    return path.join(installationDir, executablePathByBrowser[options.browser](options.platform, options.buildId));
  }
}
function parseFolderPath(folderPath) {
  const name = path.basename(folderPath);
  const splits = name.split("-");
  if (splits.length !== 2) {
    return;
  }
  const [platform, buildId] = splits;
  if (!buildId || !platform) {
    return;
  }
  return { platform, buildId };
}
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
debug("puppeteer:browsers:launcher");
function computeExecutablePath(options) {
  if (options.cacheDir === null) {
    options.platform ??= detectBrowserPlatform();
    if (options.platform === void 0) {
      throw new Error(`No platform specified. Couldn't auto-detect browser platform.`);
    }
    return executablePathByBrowser[options.browser](options.platform, options.buildId);
  }
  return new Cache(options.cacheDir).computeExecutablePath(options);
}
/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
node_util.promisify(childProcess.execFile);
debug("puppeteer:browsers:fileUtil");
/**
 * @license
 * Copyright 2017 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
debug("puppeteer:browsers:install");
const require$1 = node_module.createRequire(require("url").pathToFileURL(__filename).href);
const lock = require$1("../../browser.lock.json");
function resolveBrowserPlatform(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "arm64") return BrowserPlatform.MAC_ARM;
  if (platform === "darwin" && arch === "x64") return BrowserPlatform.MAC;
  if (platform === "win32" && arch === "x64") return BrowserPlatform.WIN64;
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
          computeExecutablePath({
            cacheDir: null,
            browser: Browser.CHROME,
            buildId: lock.version,
            platform
          })
        );
      }
      return computeExecutablePath({
        cacheDir: path.join(options.repoRoot, ".browsers"),
        browser: Browser.CHROME,
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
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
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
    await fs$1.mkdir(dir, { recursive: true });
    return dir;
  }
  listProfiles() {
    return fs.readdirSync(this.paths.profilesRoot(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
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
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
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
    icon: path.join(__dirname, "../../resources/icon.png"),
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
