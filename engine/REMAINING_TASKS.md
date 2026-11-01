# Remaining Tasks - OpenMausBot Android Local VM

## Current Working State ✅
- WebView cleartext traffic (AndroidManifest.xml + network_security_config.xml)
- Chrome/agent-browser copy to tools dir (NodeHostService.kt)
- libtalloc.so.2 staged in assets
- Missing `/lib/ld-linux-aarch64.so.1` symlink created automatically on extraction
- Desktop stack: Xtigervnc, websockify, cua-driver running
- Local computer API: status, run, start, stop, remove
- Screenshot API works
- noVNC viewer accessible at port 6902
- Server health endpoint works

---

## Phase 1: Core Stability Fixes (High Priority)

### 1.1 Fix "fuser permission denied" during port cleanup ✅
**Issue**: NodeHostService.kt tried to run `fuser -k ${port}/tcp` but fuser is not available/permission denied on Android.
**Fix**: Already implemented - uses `ss -ltnp` to find PIDs listening on port, then kills them. Falls back to `killall libnodeexec.so`.
**File**: `android-test/app/src/main/kotlin/com/openmausbot/test/NodeHostService.kt` (lines 137-162)

### 1.2 Fix spawnAndroidGuest "Permission denied" ✅
**Issue**: `spawnAndroidGuest` in container-computer.ts uses Node.js `spawn()` to execute proot directly, which fails with "Permission denied" on Android due to SELinux. The script approach (`/system/bin/sh scriptPath`) works.
**Fix**: Refactored `androidGuest` to use script-based approach (like `androidStartDesktop`) - writes a temp shell script with all proot env vars, then executes via `/system/bin/sh scriptPath`.
**File**: `server/container-computer.ts` (function `androidGuest`)

### 1.3 Fix androidDesktopRunning reliability ✅
**Issue**: Uses `process.kill(pid, 0)` which returns EPERM on Android (proot processes run as different UID). Current code handles EPERM but may miss edge cases.
**Fix**: Updated both `androidDesktopRunning` and stop action to use `/proc/<pid>/stat` check instead of `process.kill(pid, 0)`. Also made `androidDesktopRunning` check critical processes (Xtigervnc and cua-driver) specifically rather than returning true if any process is running.
**File**: `server/container-computer.ts` (functions `androidDesktopRunning`, `androidComputerAction` stop)

---

## Phase 2: Desktop Stack Completeness (Medium Priority)

### 2.1 Ensure x11vnc starts reliably ✅
**Issue**: x11vnc process not seen in new runs (only Xtigervnc's built-in VNC). The start-desktop.sh script doesn't start x11vnc separately since Xtigervnc has built-in VNC.
**Status**: Verified - Xtigervnc's built-in VNC on port 5902 serves the desktop. x11vnc is redundant and not needed.
**File**: `server/container-computer.ts` (androidStartDesktop uses Xtigervnc with `-rfbport ${ANDROID_VNC_PORT}`)

### 2.2 Ensure openbox starts reliably  
**Issue**: openbox window manager not seen in process list for new runs.
**Fix**: Removed output suppression (`>/dev/null 2>&1`) from openbox command in start-desktop.sh and added a check to verify openbox starts successfully. Errors will now be visible in logs for debugging.
**File**: `server/container-computer.ts` (androidStartDesktop script)

---

## Phase 2: VPS/Cloud Integration (Medium Priority) - COMPLETED

### 2.1 VPS `user@host` SSH configuration ✅
**Issue**: User reports "cloud desktop is not using my vps in format user@host". The VPS computer creation expects SSH alias format, not user@host.
**Fix**: Parse user@host format and auto-create SSH config entry with a generated alias. The `resolveVpsSshAlias` function in `server/vps-computer.ts` handles this transparently.
**Files**: `server/vps-computer.ts`, `server/vps-hosts.ts`, `server/routes/computers.ts`

### 2.2 VPS timeout issues ✅
**Issue**: VPS connection times out during provisioning/connection.
**Fix**: Increased default Docker-over-SSH timeout from 2min to 5min (`DEFAULT_DOCKER_SSH_TIMEOUT_MS`), increased VPS desktop readiness timeout from 1min to 3min (`VPS_DESKTOP_READY_TIMEOUT_MS`), increased screenshot timeouts from 30s to 60s. Added better error messages with actionable guidance.
**Files**: `server/vps-computer.ts`

---

## Phase 4: MCP/Chat Integration (High Priority)

### 4.1 Fix "MCP server exited before session closed" ✅
**Issue**: Bot reports this error when trying to use MCP tools. The root cause was that `container-mcp.ts` didn't support "proot" runtime (used by Android Local VM). The script only accepted "docker", "podman", "container" as valid runtimes.
**Fix**: Updated `server/container-mcp.ts` to handle "proot" runtime by running `cua-driver mcp` inside proot with proper bind mounts and environment, connecting to the Cua Driver's Unix socket.
**Files**: `server/container-mcp.ts`

### 4.2 Verify browser automation works ✅
**Issue**: "we don't have access to internet neither a browser within the bot"
**Fix**: Added tools directory bind mount (`/tools`) to proot container so agent-browser binary (staged at `tools/agent-browser/0.37.0/agent-browser`) is accessible inside the proot environment. Also added `/tools/agent-browser/0.37.0` to PATH in proot for all proot invocations (androidGuest, androidStartDesktop, container-mcp.ts).
**Files**: `server/container-computer.ts` (androidGuest, androidStartDesktop), `server/container-mcp.ts`

---

## Phase 5: Polish & Edge Cases (Low Priority)

### 5.1 Private Desktop rename (task 1.4)
### 5.2 Private Desktop default + surface switching (task 1.5)
### 5.3 Backup merge fix
### 5.4 Chat width fix

---

## Technical Debt / Code Quality

### T1. Clean up old proot processes ✅
Multiple orphaned proot processes from previous runs accumulate. Added cleanup on app start in `NodeHostService.kt` (`cleanupOrphanedProot()` function).

### T2. Improve error messages ✅
Added context to generic error messages in `container-computer.ts` (androidComputerStatus and androidComputerAction catch blocks) to include the failing operation name.

### T3. Add integration tests
Automated verification of desktop startup, screenshot, MCP connection. Requires Android device/emulator with proot environment for Local VM tests. Current unit tests mock docker commands but don't test Android/proot paths.