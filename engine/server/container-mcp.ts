// A stdio bridge into Cua Driver's MCP server in the Local VM. It defines no tools; the shared bridge only answers ping,
// makes tool schemas provider-safe and keeps error results text-only.
import { cuaExecArgs } from "./container-computer.ts";
import { runMcpBridge } from "./mcp-bridge.ts";
import { join } from "node:path";

const [runtime, container, socket] = process.argv.slice(2);

// Android proot: the Cua Driver runs inside proot and exposes MCP via a Unix socket.
// The bridge connects directly to the socket using a small proxy.
if (runtime === "proot") {
  if (!socket?.startsWith("/")) {
    process.stderr.write("invalid Local VM connection\n");
    process.exit(2);
  }
  const linuxDir = process.env.OMB_ANDROID_LINUX_DIR ?? "";
  const rootfs = join(linuxDir, "rootfs");
  const tmpDir = join(linuxDir, "tmp");
  const toolsDir = process.env.OMB_ANDROID_DATA_DIR ? join(process.env.OMB_ANDROID_DATA_DIR, "tools") : join(linuxDir, "..", "data", "tools");

  // The who-is-driving pair rides in env, not argv, which `ps` shows to everyone; the token guards a loopback endpoint.
  const controlUrl = process.env.OMB_CONTROL_URL ?? "";
  const controlToken = process.env.OMB_CONTROL_TOKEN ?? "";

  // Run cua-driver mcp inside proot, connecting to the socket
  runMcpBridge({
    command: join(linuxDir, "proot"),
    args: [
      "-0",
      "-R", rootfs,
      "-b", `${tmpDir}:/tmp`,
      "-b", "/dev:/dev",
      "-b", `${rootfs}/etc/passwd:/etc/passwd`,
      "-b", `${toolsDir}:/tools`,
      "-w", "/tmp",
      "/bin/bash", "-lc",
      `CUA_DRIVER_INSTALL_CHANNEL=python_package CUA_DRIVER_RS_TELEMETRY_ENABLED=0 CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=200 NO_COLOR=1 DISPLAY=:2 /usr/local/libexec/openmausbot/cua-driver mcp --socket ${socket}`,
    ],
    env: {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/tools/agent-browser/0.37.0",
      HOME: "/root",
      TMPDIR: tmpDir,
      LD_LIBRARY_PATH: linuxDir,
      PROOT_TMP_DIR: tmpDir,
      PROOT_NO_SECCOMP: "1",
      PROOT_ASSUME_MEMFD_UNSUPPORTED: "1",
      PROOT_LOADER: join(linuxDir, "loader"),
    },
    label: "Cua Driver",
    ...(controlUrl && controlToken ? { gate: { url: controlUrl, token: controlToken } } : {}),
  });
  process.exit(0);
}

if (!runtime || !["docker", "podman", "container"].includes(runtime)) {
  process.stderr.write("invalid Local VM runtime\n");
  process.exit(2);
}
if (!container || !/^[a-zA-Z0-9_.-]+$/.test(container) || !socket?.startsWith("/run/user/1000/")) {
  process.stderr.write("invalid Local VM connection\n");
  process.exit(2);
}

// The who-is-driving pair rides in env, not argv, which `ps` shows to everyone; the token guards a loopback endpoint.
const controlUrl = process.env.OMB_CONTROL_URL ?? "";
const controlToken = process.env.OMB_CONTROL_TOKEN ?? "";

runMcpBridge({
  command: runtime,
  args: cuaExecArgs(["mcp", "--socket", socket], { container, interactive: true }),
  label: "Cua Driver",
  // No liveness watchdog: the runtime CLI talks to a local daemon and fails fast on its own.
  ...(controlUrl && controlToken ? { gate: { url: controlUrl, token: controlToken } } : {}),
});