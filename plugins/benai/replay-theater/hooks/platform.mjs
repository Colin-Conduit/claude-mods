// Conduit change: one place for what differs between macOS, Windows and Linux, so the mod runs on all three.

/** True when the plugin sits on a Windows drive or share (C:\Users\..., \\server\...). */
export const isWindows = (root) => /^[A-Za-z]:[\\/]|^\\\\/.test(root);

/** The home folder: the plugin's root up to its .claude folder, split on either slash. */
export const homeOf = (root) => root.split(/[\\/]\.claude[\\/]/)[0] || "";

/** Deletes a file; a missing file is no error. $.fs has no delete, so it is the system's own command. */
export async function removeFile($, path) {
  if (isWindows($.plugin.root)) await $.process.run(["cmd.exe", "/d", "/c", "del", "/f", "/q", path.replace(/\//g, "\\")]);
  else await $.process.run(["rm", "-f", path]);
}
