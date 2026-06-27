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
const node_module = require("node:module");
const childProcess = require("node:child_process");
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
function createAppLogger(paths, launcherLogStore) {
  log.transports.file.resolvePathFn = () => path.join(paths.logsDir(), "main.log");
  return {
    log(scope, level, message) {
      log[level](`[${scope}] ${message}`);
      void launcherLogStore?.append([
        {
          ts: Date.now(),
          level,
          source: "system",
          context: "background",
          browserId: "launcher",
          message: `[${scope}] ${message}`,
          data: { scope }
        }
      ]).catch(() => {
      });
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
  userDataRoot() {
    return this.userDataDir;
  }
  profilesRoot() {
    return path.join(this.userDataDir, "profiles");
  }
  logsDir() {
    return path.join(this.userDataDir, "logs");
  }
  dataFile(name) {
    return path.join(this.userDataDir, name);
  }
  async ensure() {
    await fs$1.mkdir(this.profilesRoot(), { recursive: true });
    await fs$1.mkdir(this.logsDir(), { recursive: true });
  }
}
const COLORS = ["blue", "purple", "cyan", "green", "coral", "red"];
const PROFILE_ID$1 = /^[a-zA-Z0-9_-]+$/;
class BrowserProfileStore {
  constructor(paths, profiles, options = {}) {
    this.profiles = profiles;
    this.filePath = paths.dataFile("browsers.json");
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? createProfileId;
  }
  async list() {
    return this.readProfiles();
  }
  async create() {
    const profiles = await this.readProfiles();
    const id = this.nextProfileId(profiles);
    const userDataDir = await this.profiles.ensureProfile(id);
    const profile = {
      id,
      displayName: defaultDisplayName(profiles.length),
      type: "persistent",
      colorKey: COLORS[profiles.length % COLORS.length],
      createdAt: this.now(),
      lastUsedAt: null,
      userDataDir
    };
    await this.writeProfiles([...profiles, profile]);
    return profile;
  }
  async duplicate(id) {
    const profiles = await this.readProfiles();
    const source = profiles.find((profile2) => profile2.id === id);
    if (!source) {
      throw new Error(`Unknown browser profile: ${id}`);
    }
    const nextId = this.nextProfileId(profiles);
    const userDataDir = await this.profiles.copyProfile(source.id, nextId);
    const profile = {
      ...source,
      id: nextId,
      displayName: `${source.displayName} 副本`,
      colorKey: COLORS[profiles.length % COLORS.length],
      createdAt: this.now(),
      lastUsedAt: null,
      userDataDir
    };
    await this.writeProfiles([...profiles, profile]);
    return profile;
  }
  async remove(id) {
    const profiles = await this.readProfiles();
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index < 0) {
      throw new Error(`Unknown browser profile: ${id}`);
    }
    const removed = profiles[index];
    await this.profiles.deleteProfile(id);
    await this.writeProfiles(profiles.filter((profile) => profile.id !== id));
    return removed;
  }
  async rename(id, displayName) {
    const profiles = await this.readProfiles();
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index < 0) {
      throw new Error(`Unknown browser profile: ${id}`);
    }
    const next = [...profiles];
    next[index] = {
      ...next[index],
      displayName: displayName.trim() || defaultDisplayName(index)
    };
    await this.writeProfiles(next);
    return next[index];
  }
  async touch(id) {
    const profiles = await this.readProfiles();
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index < 0) {
      throw new Error(`Unknown browser profile: ${id}`);
    }
    const next = [...profiles];
    next[index] = {
      ...next[index],
      lastUsedAt: this.now()
    };
    await this.writeProfiles(next);
    return next[index];
  }
  async readProfiles() {
    try {
      const raw = JSON.parse(await fs$1.readFile(this.filePath, "utf8"));
      if (Array.isArray(raw.profiles)) {
        return raw.profiles.map((profile) => ({ ...profile }));
      }
    } catch (error) {
      if (!isMissingFile$3(error)) {
        throw error;
      }
    }
    return [];
  }
  async writeProfiles(profiles) {
    await fs$1.writeFile(this.filePath, `${JSON.stringify({ profiles }, null, 2)}
`, "utf8");
  }
  nextProfileId(profiles) {
    let id = this.idFactory();
    while (profiles.some((profile) => profile.id === id)) {
      id = this.idFactory();
    }
    if (!PROFILE_ID$1.test(id)) {
      throw new Error(`Invalid profile id: ${id}`);
    }
    return id;
  }
}
function createProfileId() {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
function defaultDisplayName(index) {
  return `浏览器 ${index + 1}`;
}
function isMissingFile$3(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
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
    this.profileListeners = /* @__PURE__ */ new Set();
    this.instances = /* @__PURE__ */ new Map();
    this.statusValues = /* @__PURE__ */ new Map();
    this.spawnBrowser = deps.spawnBrowser ?? defaultSpawnBrowser;
    this.focusExisting = deps.focusExisting ?? defaultFocusExisting;
  }
  async launch(profileId = "default") {
    const status = this.profileStatus(profileId);
    if (status === "launching") return;
    const current = this.instances.get(profileId);
    if (status === "running" && current) {
      await this.focusExisting(current.binary, current.argv);
      return;
    }
    const userDataDir = await this.deps.profiles.ensureProfile(profileId);
    const binary = this.deps.resources.browserBinary();
    const argv = buildArgv({
      userDataDir,
      extensionDir: this.deps.resources.extensionDir(),
      startUrl: "chrome://newtab"
    });
    this.setProfileStatus(profileId, "launching");
    this.deps.logger.log("BrowserSupervisor", "info", `launching profile ${profileId}`);
    let child;
    try {
      child = this.spawnBrowser(binary, argv);
    } catch (error) {
      this.instances.delete(profileId);
      this.setProfileStatus(profileId, "error");
      throw error;
    }
    this.instances.set(profileId, {
      child,
      binary,
      argv: [...argv],
      shutdownRequested: false
    });
    this.attachBrowserLogs(profileId, child);
    this.bindChildEvents(profileId, child);
  }
  async stop(profileId) {
    const current = this.instances.get(profileId);
    if (!current) {
      this.setProfileStatus(profileId, "idle");
      return;
    }
    this.deps.logger.log("BrowserSupervisor", "info", `stopping profile ${profileId}`);
    await new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(settle, 2e3);
      current.child.on("exit", settle);
      current.shutdownRequested = true;
      current.child.kill();
    });
  }
  status() {
    const statuses = Array.from(this.statusValues.values());
    if (statuses.includes("error")) return "error";
    if (statuses.includes("launching")) return "launching";
    if (statuses.includes("running")) return "running";
    return "idle";
  }
  statuses() {
    return Object.fromEntries(this.statusValues.entries());
  }
  onStatusChange(cb) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  onProfileStatusChange(cb) {
    this.profileListeners.add(cb);
    return () => {
      this.profileListeners.delete(cb);
    };
  }
  async requestShutdown() {
    await Promise.all(Array.from(this.instances.keys()).map((profileId) => this.stop(profileId)));
  }
  bindChildEvents(profileId, child) {
    child.on("spawn", () => {
      if (this.instances.get(profileId)?.child === child) {
        this.deps.logger.log("BrowserSupervisor", "info", `profile ${profileId} running`);
        this.setProfileStatus(profileId, "running");
      }
    });
    child.on("error", (error) => {
      if (this.instances.get(profileId)?.child !== child) return;
      this.deps.logger.log("BrowserSupervisor", "error", error.message);
      this.instances.delete(profileId);
      this.setProfileStatus(profileId, "error");
    });
    child.on("exit", (code, signal) => {
      const current = this.instances.get(profileId);
      if (current?.child !== child) return;
      const wasRequestedShutdown = current.shutdownRequested;
      const wasNormalExit = (code === 0 || code === null) && signal === null;
      this.instances.delete(profileId);
      this.deps.logger.log(
        "BrowserSupervisor",
        wasRequestedShutdown || wasNormalExit ? "info" : "error",
        `profile ${profileId} exited with code ${code ?? "null"} signal ${signal ?? "null"}`
      );
      this.setProfileStatus(profileId, wasRequestedShutdown || wasNormalExit ? "idle" : "error");
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
  profileStatus(profileId) {
    return this.statusValues.get(profileId) ?? "idle";
  }
  setProfileStatus(profileId, next) {
    if (next === this.profileStatus(profileId)) return;
    const previousAggregate = this.status();
    this.statusValues.set(profileId, next);
    this.profileListeners.forEach((listener) => {
      listener(profileId, next);
    });
    const nextAggregate = this.status();
    if (previousAggregate !== nextAggregate) {
      this.listeners.forEach((listener) => {
        listener(nextAggregate);
      });
    }
  }
}
function defaultSpawnBrowser(binary, argv) {
  return childProcess.spawn(binary, argv, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
}
function defaultFocusExisting(binary, argv) {
  const process2 = childProcess.spawn(binary, argv, { detached: true, stdio: "ignore" });
  process2.unref();
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
  options.ipcMain.handle(
    "browser:getStatuses",
    async () => {
      return options.supervisor.statuses();
    }
  );
  options.ipcMain.handle("browser:listProfiles", async () => {
    return options.profileStore.list();
  });
  options.ipcMain.handle("browser:addProfile", async () => {
    try {
      return { ok: true, profile: await options.profileStore.create() };
    } catch (error) {
      return { ok: false, error: toUserSafeMessage(error) };
    }
  });
  options.ipcMain.handle(
    "browser:renameProfile",
    async (_event, profileId, displayName) => {
      try {
        return { ok: true, profile: await options.profileStore.rename(profileId, displayName) };
      } catch (error) {
        return { ok: false, error: toUserSafeMessage(error) };
      }
    }
  );
  options.ipcMain.handle(
    "browser:duplicateProfile",
    async (_event, profileId) => {
      try {
        return { ok: true, profile: await options.profileStore.duplicate(profileId) };
      } catch (error) {
        return { ok: false, error: toUserSafeMessage(error) };
      }
    }
  );
  options.ipcMain.handle(
    "browser:removeProfile",
    async (_event, profileId) => {
      try {
        return { ok: true, profile: await options.profileStore.remove(profileId) };
      } catch (error) {
        return { ok: false, error: toUserSafeMessage(error) };
      }
    }
  );
  options.ipcMain.handle(
    "browser:openProfileFolder",
    async (_event, profileId) => {
      try {
        const profile = (await options.profileStore.list()).find((item) => item.id === profileId);
        if (!profile) {
          throw new Error(`Unknown browser profile: ${profileId}`);
        }
        const message = await options.openPath(profile.userDataDir);
        if (message.length > 0) {
          throw new Error(message);
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: toUserSafeMessage(error) };
      }
    }
  );
  options.ipcMain.handle(
    "browser:launchProfile",
    async (_event, profileId) => {
      try {
        await options.supervisor.launch(profileId);
        await options.profileStore.touch(profileId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: toUserSafeMessage(error) };
      }
    }
  );
  options.ipcMain.handle(
    "browser:stopProfile",
    async (_event, profileId) => {
      try {
        await options.supervisor.stop(profileId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: toUserSafeMessage(error) };
      }
    }
  );
  options.ipcMain.handle("app:getVersions", async () => {
    return {
      app: options.getAppVersion(),
      browser: options.resources.browserVersion(),
      extension: readExtensionVersion(options.resources.extensionDir())
    };
  });
  options.ipcMain.handle("app:openLogs", async () => {
    try {
      await options.openLogs();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toUserSafeMessage(error) };
    }
  });
  options.ipcMain.handle("logs:query", async (_event, filter) => {
    return options.logStore.query(asRecord$1(filter));
  });
  options.ipcMain.handle("logs:clear", async () => {
    try {
      await options.logStore.clear();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toUserSafeMessage(error) };
    }
  });
  options.ipcMain.handle("settings:get", async () => {
    return options.settingsStore.get();
  });
  options.ipcMain.handle(
    "settings:update",
    async (_event, patch) => {
      try {
        return { ok: true, settings: await options.settingsStore.update(patch) };
      } catch (error) {
        return { ok: false, error: toUserSafeMessage(error) };
      }
    }
  );
  options.ipcMain.handle("tokens:getSummary", async () => {
    return options.tokenUsageStore.summary();
  });
  options.ipcMain.handle("telemetry:ingest", async (_event, payload) => {
    try {
      return { ok: true, result: await options.telemetryIngest.ingest(payload) };
    } catch (error) {
      return { ok: false, error: toUserSafeMessage(error) };
    }
  });
  const unsubscribeStatus = options.supervisor.onStatusChange(options.sendStatus);
  const unsubscribeProfileStatus = options.supervisor.onProfileStatusChange((profileId, status) => {
    options.sendProfileStatus({ profileId, status });
  });
  return () => {
    unsubscribeStatus();
    unsubscribeProfileStatus();
  };
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
function asRecord$1(value) {
  return value && typeof value === "object" ? value : {};
}
const LEVEL_ORDER = ["debug", "info", "warn", "error"];
const SENSITIVE_LOG_KEYS = /* @__PURE__ */ new Set([
  "accesstoken",
  "apikey",
  "apisecret",
  "authorization",
  "authtoken",
  "bearer",
  "bearertoken",
  "clientsecret",
  "idtoken",
  "refreshtoken",
  "secret",
  "token",
  "xapikey",
  "xauthorization"
]);
class LauncherLogStore {
  constructor(paths, settings) {
    this.settings = settings;
    this.filePath = paths.dataFile("launcher-logs.json");
  }
  async query(filter = {}) {
    const entries = await this.readEntries();
    const text = filter.text?.trim().toLowerCase();
    return entries.filter((entry) => !filter.levels?.length || filter.levels.includes(entry.level)).filter((entry) => !filter.sources?.length || filter.sources.includes(entry.source)).filter((entry) => !filter.browserIds?.length || filter.browserIds.includes(entry.browserId)).filter((entry) => filter.sinceTs === void 0 || entry.ts >= filter.sinceTs).filter((entry) => filter.untilTs === void 0 || entry.ts <= filter.untilTs).filter((entry) => !text || entry.message.toLowerCase().includes(text)).slice(-(filter.limit ?? 500));
  }
  async append(entries) {
    const current = await this.readEntries();
    let nextId = current.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
    const appended = entries.map((entry) => ({
      ...entry,
      id: nextId++,
      data: sanitizeLogData(entry.data)
    }));
    const next = await this.applyRetention([...current, ...appended]);
    await this.writeEntries(next);
    return appended;
  }
  async clear() {
    await this.writeEntries([]);
  }
  async purge() {
    await this.writeEntries(await this.applyRetention(await this.readEntries()));
  }
  async applyRetention(entries) {
    const { logs } = await this.settings.get();
    const minimumLevelIndex = LEVEL_ORDER.indexOf(logs.minLevel);
    const cutoff = Date.now() - logs.retentionDays * 24 * 60 * 60 * 1e3;
    return entries.filter((entry) => entry.ts >= cutoff).filter((entry) => LEVEL_ORDER.indexOf(entry.level) >= minimumLevelIndex).sort((a, b) => a.ts - b.ts).slice(-logs.maxEntries);
  }
  async readEntries() {
    try {
      const raw = JSON.parse(await fs$1.readFile(this.filePath, "utf8"));
      return Array.isArray(raw.entries) ? raw.entries : [];
    } catch (error) {
      if (!isMissingFile$2(error)) {
        throw error;
      }
      return [];
    }
  }
  async writeEntries(entries) {
    await fs$1.writeFile(this.filePath, `${JSON.stringify({ entries }, null, 2)}
`, "utf8");
  }
}
function sanitizeLogData(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeLogData);
  }
  if (value && typeof value === "object") {
    const clean = {};
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveLogKey(key)) {
        clean[key] = "[redacted]";
      } else {
        clean[key] = sanitizeLogData(child);
      }
    }
    return clean;
  }
  return value;
}
function isSensitiveLogKey(key) {
  return SENSITIVE_LOG_KEYS.has(key.toLowerCase().replace(/[-_\s]/g, ""));
}
function isMissingFile$2(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
const DEFAULT_LAUNCHER_SETTINGS = {
  launch: {
    windowWidth: 1280,
    windowHeight: 820,
    startUrl: "chrome://newtab",
    concurrencyLimit: 3,
    staggerMs: 400,
    profileType: "persistent",
    proxyMode: "none",
    language: "zh-CN",
    zoom: 100
  },
  behavior: {
    closeAction: "ask",
    exitWithBrowsers: "ask",
    openAtLogin: false,
    downloadDir: ""
  },
  logs: {
    retentionDays: 3,
    maxEntries: 5e3,
    minLevel: "info",
    captureLlmRequests: true,
    captureLlmResponses: false,
    defaultExportFormat: "json"
  },
  localUser: {
    displayName: "本地用户",
    colorKey: "purple"
  }
};
class LauncherSettingsStore {
  constructor(paths) {
    this.filePath = paths.dataFile("settings.json");
  }
  async get() {
    try {
      const raw = JSON.parse(await fs$1.readFile(this.filePath, "utf8"));
      return mergeSettings(DEFAULT_LAUNCHER_SETTINGS, raw);
    } catch (error) {
      if (!isMissingFile$1(error)) {
        throw error;
      }
      return structuredClone(DEFAULT_LAUNCHER_SETTINGS);
    }
  }
  async update(patch) {
    const next = mergeSettings(await this.get(), patch);
    await fs$1.writeFile(this.filePath, `${JSON.stringify(next, null, 2)}
`, "utf8");
    return next;
  }
}
function mergeSettings(base, patch) {
  return {
    launch: { ...base.launch, ...patch.launch },
    behavior: { ...base.behavior, ...patch.behavior },
    logs: { ...base.logs, ...patch.logs },
    localUser: { ...base.localUser, ...patch.localUser }
  };
}
function isMissingFile$1(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
const LOG_LEVELS = ["debug", "info", "warn", "error"];
const LOG_SOURCES = [
  "agent",
  "llm",
  "tabs",
  "page",
  "chaoxing",
  "config",
  "system"
];
const LOG_CONTEXTS = ["background", "sidepanel", "newtab", "hub", "content"];
class LauncherTelemetryIngest {
  constructor(logStore, tokenUsageStore) {
    this.logStore = logStore;
    this.tokenUsageStore = tokenUsageStore;
  }
  async ingest(message) {
    const payload = asRecord(message);
    const browserId = asNonEmptyString(payload.browserId);
    if (!browserId) {
      throw new Error("Telemetry browserId is required");
    }
    const logs = normalizeLogs(payload.logs, browserId);
    const explicitTokenUsage = normalizeTokenUsageBatch(payload.tokenUsage, browserId);
    const inferredTokenUsage = logs.map((entry, index) => extractTokenUsage(entry, index)).filter((record) => record !== void 0);
    const tokenUsage = [...explicitTokenUsage, ...inferredTokenUsage];
    if (logs.length > 0) {
      await this.logStore.append(logs);
    }
    if (tokenUsage.length > 0) {
      await this.tokenUsageStore.append(tokenUsage);
    }
    return {
      logs: logs.length,
      tokenUsage: tokenUsage.length
    };
  }
}
function normalizeLogs(value, fallbackBrowserId) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeLog(item, fallbackBrowserId)).filter((entry) => entry !== void 0);
}
function normalizeLog(value, fallbackBrowserId) {
  const draft = asRecord(value);
  const message = asNonEmptyString(draft.message);
  if (!message) return void 0;
  return {
    ts: asFiniteNumber(draft.ts) ?? Date.now(),
    level: oneOf(draft.level, LOG_LEVELS) ?? "info",
    source: oneOf(draft.source, LOG_SOURCES) ?? "system",
    context: oneOf(draft.context, LOG_CONTEXTS) ?? "background",
    browserId: asNonEmptyString(draft.browserId) ?? fallbackBrowserId,
    message,
    data: draft.data
  };
}
function normalizeTokenUsageBatch(value, fallbackBrowserId) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => normalizeTokenUsage(item, fallbackBrowserId, index)).filter((record) => record !== void 0);
}
function normalizeTokenUsage(value, fallbackBrowserId, index) {
  const draft = asRecord(value);
  const ts = asFiniteNumber(draft.ts) ?? Date.now();
  const browserId = asNonEmptyString(draft.browserId) ?? fallbackBrowserId;
  const model = asNonEmptyString(draft.model) ?? "unknown";
  const inputTokens = asNonNegativeNumber(draft.inputTokens) ?? 0;
  const outputTokens = asNonNegativeNumber(draft.outputTokens) ?? 0;
  const totalTokens = asNonNegativeNumber(draft.totalTokens) ?? inputTokens + outputTokens;
  if (totalTokens <= 0) return void 0;
  return {
    id: asNonEmptyString(draft.id) ?? usageId(browserId, ts, index, totalTokens),
    ts,
    browserId,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostCny: asNonNegativeNumber(draft.estimatedCostCny) ?? 0
  };
}
function extractTokenUsage(entry, index) {
  if (entry.source !== "llm") return void 0;
  const usage = findUsageObject(entry.data);
  if (!usage) return void 0;
  const inputTokens = asNonNegativeNumber(usage.inputTokens) ?? asNonNegativeNumber(usage.input_tokens) ?? asNonNegativeNumber(usage.promptTokens) ?? asNonNegativeNumber(usage.prompt_tokens) ?? 0;
  const outputTokens = asNonNegativeNumber(usage.outputTokens) ?? asNonNegativeNumber(usage.output_tokens) ?? asNonNegativeNumber(usage.completionTokens) ?? asNonNegativeNumber(usage.completion_tokens) ?? 0;
  const totalTokens = asNonNegativeNumber(usage.totalTokens) ?? asNonNegativeNumber(usage.total_tokens) ?? inputTokens + outputTokens;
  if (totalTokens <= 0) return void 0;
  return {
    id: usageId(entry.browserId, entry.ts, index, totalTokens),
    ts: entry.ts,
    browserId: entry.browserId,
    model: findStringByKey(entry.data, "model") ?? "unknown",
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostCny: 0
  };
}
function findUsageObject(value, depth = 0) {
  if (depth > 8) return void 0;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUsageObject(item, depth + 1);
      if (found) return found;
    }
    return void 0;
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return void 0;
  if (record.usage && typeof record.usage === "object" && (hasTokenCount(record.usage) || hasTokenCount(asRecord(record.usage)))) {
    return asRecord(record.usage);
  }
  if (hasTokenCount(record)) {
    return record;
  }
  for (const child of Object.values(record)) {
    const found = findUsageObject(child, depth + 1);
    if (found) return found;
  }
  return void 0;
}
function hasTokenCount(value) {
  const record = asRecord(value);
  return [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
    "totalTokens",
    "total_tokens"
  ].some((key) => asNonNegativeNumber(record[key]) !== void 0);
}
function findStringByKey(value, key, depth = 0) {
  if (depth > 8) return void 0;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKey(item, key, depth + 1);
      if (found) return found;
    }
    return void 0;
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return void 0;
  const direct = asNonEmptyString(record[key]);
  if (direct) return direct;
  for (const child of Object.values(record)) {
    const found = findStringByKey(child, key, depth + 1);
    if (found) return found;
  }
  return void 0;
}
function usageId(browserId, ts, index, totalTokens) {
  return `usage-${browserId}-${Math.trunc(ts)}-${index}-${Math.trunc(totalTokens)}`;
}
function oneOf(value, values) {
  return typeof value === "string" && values.includes(value) ? value : void 0;
}
function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}
function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function asNonNegativeNumber(value) {
  const number = asFiniteNumber(value);
  return number !== void 0 && number >= 0 ? number : void 0;
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
  async copyProfile(sourceId, targetId) {
    const targetDir = this.profileDir(targetId);
    await fs$1.cp(this.profileDir(sourceId), targetDir, {
      errorOnExist: true,
      force: false,
      recursive: true
    });
    return targetDir;
  }
  async deleteProfile(id) {
    await fs$1.rm(this.profileDir(id), { force: true, recursive: true });
  }
  profileDir(id) {
    if (!PROFILE_ID.test(id)) {
      throw new Error(`Invalid profile id: ${id}`);
    }
    return path.join(this.paths.profilesRoot(), id);
  }
}
class TokenUsageStore {
  constructor(paths) {
    this.filePath = paths.dataFile("token-usage.json");
  }
  async summary() {
    const records = await this.readRecords();
    return {
      totalInputTokens: sum(records, "inputTokens"),
      totalOutputTokens: sum(records, "outputTokens"),
      totalTokens: sum(records, "totalTokens"),
      estimatedCostCny: roundCurrency(sum(records, "estimatedCostCny")),
      byBrowser: bucket(records, (record) => record.browserId),
      byModel: bucket(records, (record) => record.model),
      daily: bucket(records, (record) => new Date(record.ts).toISOString().slice(0, 10)),
      recent: records.slice().sort((a, b) => b.ts - a.ts).slice(0, 20)
    };
  }
  async append(records) {
    const next = [...await this.readRecords(), ...records.map(sanitizeRecord)];
    await fs$1.writeFile(this.filePath, `${JSON.stringify({ records: next }, null, 2)}
`, "utf8");
  }
  async readRecords() {
    try {
      const raw = JSON.parse(await fs$1.readFile(this.filePath, "utf8"));
      return Array.isArray(raw.records) ? raw.records : [];
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
      return [];
    }
  }
}
function bucket(records, keyOf) {
  const buckets = /* @__PURE__ */ new Map();
  for (const record of records) {
    const key = keyOf(record);
    const current = buckets.get(key) ?? {
      key,
      label: key,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostCny: 0
    };
    current.inputTokens += record.inputTokens;
    current.outputTokens += record.outputTokens;
    current.totalTokens += record.totalTokens;
    current.estimatedCostCny = roundCurrency(current.estimatedCostCny + record.estimatedCostCny);
    buckets.set(key, current);
  }
  return Array.from(buckets.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}
function sum(records, key) {
  return records.reduce((total, record) => {
    const value = record[key];
    return typeof value === "number" ? total + value : total;
  }, 0);
}
function sanitizeRecord(record) {
  return {
    id: record.id,
    ts: record.ts,
    browserId: record.browserId,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens: record.totalTokens,
    estimatedCostCny: record.estimatedCostCny
  };
}
function roundCurrency(value) {
  return Math.round(value * 1e4) / 1e4;
}
function isMissingFile(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
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
  const resources = createBrowserResources({
    repoRoot: resolveRepoRoot(electron.app.getAppPath()),
    isPackaged: electron.app.isPackaged,
    resourcesPath: process.resourcesPath
  });
  const profiles = new ProfileStore(paths);
  const profileStore = new BrowserProfileStore(paths, profiles);
  const settingsStore = new LauncherSettingsStore(paths);
  const logStore = new LauncherLogStore(paths, settingsStore);
  const tokenUsageStore = new TokenUsageStore(paths);
  const telemetryIngest = new LauncherTelemetryIngest(logStore, tokenUsageStore);
  const logger = createAppLogger(paths, logStore);
  const supervisor = new BrowserSupervisor({ resources, profiles, logger });
  let currentWindow;
  registerDesktopBridge({
    ipcMain: electron.ipcMain,
    supervisor,
    profileStore,
    logStore,
    settingsStore,
    telemetryIngest,
    tokenUsageStore,
    resources,
    getAppVersion: () => electron.app.getVersion(),
    openLogs: async () => {
      const message = await electron.shell.openPath(paths.logsDir());
      if (message.length > 0) {
        throw new Error(message);
      }
    },
    openPath: (targetPath) => electron.shell.openPath(targetPath),
    sendStatus: (status) => currentWindow?.webContents.send("browser:status-changed", status),
    sendProfileStatus: (payload) => currentWindow?.webContents.send("browser:profile-status-changed", payload)
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
  const win = new electron.BrowserWindow(
    buildControlWindowOptions({
      platform: process.platform,
      iconPath: path.join(__dirname, "../../resources/icon.png"),
      preloadPath: path.join(__dirname, "../preload/index.js")
    })
  );
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
function buildControlWindowOptions(input) {
  return {
    width: 1120,
    height: 720,
    minWidth: 920,
    minHeight: 600,
    resizable: true,
    maximizable: true,
    titleBarStyle: input.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: input.platform === "win32" ? {
      color: "#FAFAFA",
      symbolColor: "#060606",
      height: 32
    } : void 0,
    icon: input.iconPath,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}
startMainBootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
