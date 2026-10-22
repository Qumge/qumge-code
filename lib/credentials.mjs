import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function credentialsDir() {
  return process.env.QMG_HOME || path.join(homedir(), ".qmg");
}

export function credentialsPath() {
  return path.join(credentialsDir(), "credentials.json");
}

export function loadCredentials() {
  let raw;
  try {
    raw = readFileSync(credentialsPath(), "utf8");
  } catch {
    return null;
  }
  // A truncated or hand-edited file means "not logged in", never a crash:
  // the only thing the user can do about it is run qumge login again.
  try {
    const creds = JSON.parse(raw);
    return creds && typeof creds.api_key === "string" && creds.api_key ? creds : null;
  } catch {
    return null;
  }
}

export function saveCredentials(creds) {
  const dir = credentialsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode is subject to umask and is ignored for an existing directory.
  try {
    chmodSync(dir, 0o700);
  } catch {
    // A directory we do not own (shared QMG_HOME) still holds a 0600 file.
  }

  const file = credentialsPath();
  // writeFile's mode only applies when the file is created, so an existing
  // file must be chmod'ed explicitly.
  writeFileSync(file, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

// 登录时把网关的 coding 目录存下来。启动路径只读这个文件 —— 一次网络都不发，
// 而价格不跟着发布周期变旧。
export function catalogPath() {
  return path.join(credentialsDir(), "models.json");
}

export function saveCatalog(catalog) {
  const dir = credentialsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Same as saveCredentials: a shared QMG_HOME still gets a 0600 file.
  }

  const file = catalogPath();
  writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function loadCatalog() {
  let raw;
  try {
    raw = readFileSync(catalogPath(), "utf8");
  } catch {
    return null;
  }
  try {
    const catalog = JSON.parse(raw);
    // Only the shape we wrote counts. Anything else falls back to the bundle.
    if (!catalog || !Array.isArray(catalog.data)) return null;
    return catalog;
  } catch {
    return null;
  }
}

export function clearCredentials() {
  rmSync(credentialsPath(), { force: true });
}
