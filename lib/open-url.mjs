import { spawn } from "node:child_process";

// Opens the sign-in page in the user's browser. Best effort: it returns false
// instead of throwing, and the caller always prints the link as well — over
// SSH, in a container or in CI there is no browser to open.
export function openUrl(url, { platform = process.platform, env = process.env, isTTY = process.stdout.isTTY, spawnImpl = spawn } = {}) {
  // The URL comes from the server. Only ever hand a web address to the OS
  // opener, never anything it might treat as a file or a command.
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  if (env.QMG_NO_BROWSER === "1" || !isTTY) return false;
  // A remote shell: a browser would open on the other machine, or not at all.
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;

  const command = opener(platform, env);
  if (!command) return false;

  try {
    const child = spawnImpl(command[0], [...command.slice(1), parsed.href], { stdio: "ignore", detached: true });
    child.on?.("error", () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

function opener(platform, env) {
  if (platform === "darwin") return ["open"];
  // rundll32 rather than `cmd /c start`: cmd would read `&` in the URL as a
  // command separator.
  if (platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler"];
  if (platform === "linux") {
    // WSL has no X display, but can hand the URL to the Windows browser.
    if (env.WSL_DISTRO_NAME) return ["rundll32.exe", "url.dll,FileProtocolHandler"];
    if (env.DISPLAY || env.WAYLAND_DISPLAY) return ["xdg-open"];
  }
  return null;
}
