// Tier-2 Local MacBook Hardware Controller for @thenetwork/marketing (Node 26).
// Manages 1 MacBook host + 1 Dedicated Android (adb / uiautomator2 / scrcpy)
// + 1 Dedicated iPhone (xcrun devicectl / pymobiledevice3 / WebDriverAgent),
// scalable to N physical devices.
//
// Formal safety boundary:
//   Every telemetry safety check and device action dispatch delegates via ../policy.ts
//   to Vibestack/Dafny-proved `deviceBatterySafe`, `warmupDailyCap`, and
//   `canDispatchDeviceStep` from `packages/core/src/generated/marketingDevice.ts`.
//   Live hardware commands never run unless `MARKETING_LIVE_DEVICE === "1"`.
//   CAPTCHA / 2FA challenges are never bypassed: they immediately halt and
//   return `status: "needs_takeover"` for human operator intervention.

import { RealClock } from "../../../../packages/core/src/clock.ts";
import {
  deviceBatterySafe,
  warmupDailyCap,
} from "../../../../packages/core/src/generated/marketingDevice.ts";
import {
  findExecutable,
  spawnProcess,
} from "../../../../packages/core/src/runtime/process.ts";
import {
  deriveDeviceTelemetryStatus,
  deriveWarmupStage,
  evaluateDeviceActionPolicy,
  isDeviceLeaseHeldByOther,
} from "../policy.ts";
import type {
  Clock,
  DeviceNode,
  DevicePlatform,
  DeviceStatus,
  DeviceWarmupStage,
  FetchFn,
} from "../types.ts";

export { deriveWarmupStage, type FetchFn };

export interface DeviceActionInput {
  deviceOnline: boolean;
  leasedByOther: boolean;
  batteryPct: number;
  tempC: number;
  actionsToday: number;
  warmupDay: number;
  lockdown: boolean;
  targetStopped: boolean;
}

export interface ExecOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ExecFn = (cmd: string[], opts?: ExecOptions) => Promise<ExecResult>;

export type FindExecutableFn = (name: string) => string | null;

export interface DeviceBridgeOptions {
  exec?: ExecFn;
  findExecutable?: FindExecutableFn;
  fetchFn?: FetchFn;
  clock?: Clock;
  env?: Record<string, string | undefined>;
  hostMachine?: string;
  wdaBaseUrl?: string;
  execTimeoutMs?: number;
}

export interface ScannedDevice {
  platform: DevicePlatform;
  serialOrUdid: string;
  label: string;
  model: string | null;
  connectionState: "online" | "offline" | "unauthorized";
  source: "adb" | "devicectl" | "pymobiledevice3" | "wda";
  transportDetails: Record<string, string>;
}

export interface DeviceScanResult {
  hostMachine: string;
  scannedAt: string;
  devices: ScannedDevice[];
  androidCount: number;
  iosCount: number;
  wdaReachable: boolean;
  warnings: string[];
}

export interface DeviceTelemetryResult {
  deviceId: string;
  serialOrUdid: string;
  platform: DevicePlatform;
  reachable: boolean;
  batteryPct: number;
  tempC: number;
  charging: boolean | null;
  batterySafe: boolean;
  warmupDay: number;
  warmupStage: DeviceWarmupStage;
  dailyActionCap: number;
  recommendedStatus: DeviceStatus;
  polledAt: string;
  source: "adb_dumpsys" | "pymobiledevice3" | "wda" | "cached_fallback";
  error: string | null;
}

export type AndroidDeviceAction =
  | { kind: "tap"; x: number; y: number }
  | { kind: "text"; text: string }
  | { kind: "swipe"; x1: number; y1: number; x2: number; y2: number; durationMs?: number }
  | { kind: "launch_app"; packageName: string; activity?: string }
  | { kind: "screenshot"; outputPath?: string }
  | { kind: "ui_dump"; outputPath?: string }
  | { kind: "scrcpy_cmd"; args?: string[] };

export type IosDeviceAction =
  | { kind: "wda_tap"; x: number; y: number }
  | { kind: "wda_type"; text: string }
  | { kind: "wda_launch"; bundleId: string }
  | { kind: "wda_screenshot" };

export type DeviceAction = AndroidDeviceAction | IosDeviceAction;

export interface DeviceActionContext {
  leaseHolder: string;
  lockdown: boolean;
  targetStopped: boolean;
  dryRun?: boolean;
  wdaBaseUrl?: string;
  wdaSessionId?: string;
  challengeDetected?: boolean;
}

export type DeviceExecutionStatus =
  | "completed"
  | "blocked_safety"
  | "needs_takeover"
  | "failed";

export interface DeviceExecutionResult {
  ok: boolean;
  executed: boolean;
  dryRun: boolean;
  status: DeviceExecutionStatus;
  deviceId: string;
  serialOrUdid: string;
  platform: DevicePlatform;
  action: DeviceAction;
  commandPreview: string;
  output: string | null;
  reason: string;
  safetyInput: DeviceActionInput;
  executedAt: string;
}

export interface ToolDiagnostic {
  tool: "adb" | "scrcpy" | "xcrun" | "pymobiledevice3";
  platform: DevicePlatform;
  required: boolean;
  status: "ready" | "missing";
  path: string | null;
  version: string | null;
  installHint: string;
}

export interface SetupDiagnostics {
  hostMachine: string;
  checkedAt: string;
  liveDeviceEnabled: boolean;
  androidReady: boolean;
  iosReady: boolean;
  wdaReachable: boolean;
  wdaBaseUrl: string;
  tools: ToolDiagnostic[];
  nextSteps: string[];
}

const DEFAULT_WDA_URL = "http://127.0.0.1:8100";
const DEFAULT_EXEC_TIMEOUT_MS = 15_000;
const KILL_GRACE_MS = 1_500;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_WDA_TIMEOUT_MS = 5_000;
const MAX_TEXT_LENGTH = 500;
const MAX_COORD = 20_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const KNOWN_ADB_STATES = new Set([
  "device",
  "offline",
  "unauthorized",
  "recovery",
  "sideload",
  "bootloader",
  "authorizing",
  "no",
]);
const SERIAL_RE = /^[A-Za-z0-9._:-]{2,128}$/;
const PACKAGE_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const ACTIVITY_RE = /^[a-zA-Z0-9._$/-]+$/;
const BUNDLE_ID_RE = /^[a-zA-Z0-9._-]{2,128}$/;
const SAFE_OUTPUT_PATH_RE = /^\/(?:sdcard|tmp)\/[A-Za-z0-9._/-]+$/;
const SAFE_FLAG_VALUE_RE = /^[A-Za-z0-9._-]{1,64}$/;

const ALLOWED_SCRCPY_BOOL_FLAGS = new Set([
  "--stay-awake",
  "--turn-screen-off",
  "--no-audio",
  "--no-control",
  "--read-only",
  "--always-on-top",
  "--no-playback",
  "--power-off-on-close",
  "--show-touches",
]);

const ALLOWED_SCRCPY_VALUE_FLAGS = new Set([
  "--max-size",
  "--max-fps",
  "--video-bit-rate",
  "--display-orientation",
  "--window-x",
  "--window-y",
  "--window-width",
  "--window-height",
]);

function createDefaultClock(): Clock {
  return new RealClock();
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function stripControlChars(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) {
      out += value[i];
    }
  }
  return out;
}

function isValidSerial(serial: string): boolean {
  return SERIAL_RE.test(serial) && !serial.startsWith("-");
}

function isValidPackageName(pkg: string): boolean {
  return (
    pkg.length > 0 &&
    pkg.length <= 160 &&
    PACKAGE_NAME_RE.test(pkg) &&
    !pkg.startsWith("-") &&
    !pkg.includes("..")
  );
}

function isValidActivity(activity: string): boolean {
  return (
    activity.length > 0 &&
    activity.length <= 160 &&
    ACTIVITY_RE.test(activity) &&
    !activity.startsWith("-") &&
    !activity.includes("..")
  );
}

function isValidOutputPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    SAFE_OUTPUT_PATH_RE.test(path) &&
    !path.includes("..")
  );
}

function validateScrcpyArgs(args: readonly string[] | undefined): string | null {
  if (!args || args.length === 0) return null;
  if (args.length > 12) return "scrcpy_cmd accepts at most 12 allowlisted arguments.";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (ALLOWED_SCRCPY_BOOL_FLAGS.has(arg)) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      const flag = arg.slice(0, eq);
      const val = arg.slice(eq + 1);
      if (ALLOWED_SCRCPY_VALUE_FLAGS.has(flag) && SAFE_FLAG_VALUE_RE.test(val)) {
        continue;
      }
      return `Disallowed scrcpy argument: ${arg}`;
    }
    if (ALLOWED_SCRCPY_VALUE_FLAGS.has(arg)) {
      const next = args[i + 1];
      if (!next || !SAFE_FLAG_VALUE_RE.test(next)) {
        return `Missing or invalid value for scrcpy flag: ${arg}`;
      }
      i += 1;
      continue;
    }
    return `Disallowed scrcpy argument: ${arg}`;
  }
  return null;
}

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isValidCoord(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_COORD;
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  let truncated = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total < maxBytes) {
        const remaining = maxBytes - total;
        const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        out += decoder.decode(slice, { stream: true });
        total += slice.byteLength;
        if (value.byteLength > remaining) {
          truncated = true;
        }
      } else {
        truncated = true;
      }
    }
    out += decoder.decode();
  } catch {
    // Stream closed after process kill.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore already released lock.
    }
  }
  return truncated ? `${out}\n[truncated]` : out;
}

/** Default Node 26 process runner backed by `spawnProcess` with SIGTERM->SIGKILL timeout and bounded output. */
export async function defaultProcessExec(
  cmd: string[],
  opts?: ExecOptions,
): Promise<ExecResult> {
  if (cmd.length === 0) {
    return { exitCode: 127, stdout: "", stderr: "Empty command" };
  }
  const timeoutMs =
    opts?.timeoutMs !== undefined && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? Math.round(opts.timeoutMs)
      : DEFAULT_EXEC_TIMEOUT_MS;
  const maxOutputBytes =
    opts?.maxOutputBytes !== undefined &&
    Number.isFinite(opts.maxOutputBytes) &&
    opts.maxOutputBytes > 0
      ? Math.round(opts.maxOutputBytes)
      : DEFAULT_MAX_OUTPUT_BYTES;

  let softTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const proc = spawnProcess(cmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    softTimer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // Process already exited.
      }
      hardTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Process already exited.
        }
      }, KILL_GRACE_MS);
    }, timeoutMs);

    const [stdout, stderr, exitCode] = await Promise.all([
      readBoundedStream(proc.stdout, maxOutputBytes),
      readBoundedStream(proc.stderr, maxOutputBytes),
      proc.exited,
    ]);

    if (timedOut) {
      return {
        exitCode: 124,
        stdout,
        stderr: stderr || `Command timed out after ${timeoutMs}ms`,
      };
    }
    return { exitCode, stdout, stderr };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 127, stdout: "", stderr: message };
  } finally {
    if (softTimer) clearTimeout(softTimer);
    if (hardTimer) clearTimeout(hardTimer);
  }
}

/** Parses `adb devices -l` stdout into structured ScannedDevice entries. */
export function parseAdbDevicesOutput(stdout: string): ScannedDevice[] {
  const devices: ScannedDevice[] = [];
  const lines = stdout.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("List of devices") || line.startsWith("*")) {
      continue;
    }
    const tokens = line.split(/\s+/);
    const serial = tokens[0];
    const state = tokens[1];
    if (!serial || !state || !KNOWN_ADB_STATES.has(state) || !isValidSerial(serial)) {
      continue;
    }

    const transportDetails: Record<string, string> = {};
    for (let i = 2; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token) continue;
      const sep = token.indexOf(":");
      if (sep > 0) {
        transportDetails[token.slice(0, sep)] = token.slice(sep + 1);
      }
    }

    const connectionState: ScannedDevice["connectionState"] =
      state === "device"
        ? "online"
        : state === "unauthorized" || state === "authorizing"
          ? "unauthorized"
          : "offline";

    const model = transportDetails["model"] ?? transportDetails["device"] ?? null;
    devices.push({
      platform: "android",
      serialOrUdid: serial,
      label: model ? `android-${model}-${serial.slice(-4)}` : `android-${serial}`,
      model,
      connectionState,
      source: "adb",
      transportDetails,
    });
  }

  return devices;
}

/** Parses `adb -s <serial> shell dumpsys battery` output. */
export function parseAdbBatteryOutput(stdout: string): {
  batteryPct: number | null;
  tempC: number | null;
  charging: boolean | null;
} {
  let rawLevel: number | null = null;
  let scale: number | null = null;
  let tempC: number | null = null;
  let acPowered = false;
  let usbPowered = false;
  let wirelessPowered = false;
  let sawPowerField = false;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();

    if (key === "level") {
      const parsed = Number.parseInt(val, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        rawLevel = parsed;
      }
    } else if (key === "scale") {
      const parsed = Number.parseInt(val, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        scale = parsed;
      }
    } else if (key === "temperature") {
      // Android dumpsys reports temperature in tenths of a degree Celsius (e.g., 325 => 32.5 C).
      const parsed = Number.parseFloat(val);
      if (Number.isFinite(parsed) && parsed >= -200 && parsed <= 1000) {
        tempC = Math.round((parsed / 10) * 10) / 10;
      }
    } else if (key === "ac powered") {
      sawPowerField = true;
      acPowered = val.toLowerCase() === "true";
    } else if (key === "usb powered") {
      sawPowerField = true;
      usbPowered = val.toLowerCase() === "true";
    } else if (key === "wireless powered") {
      sawPowerField = true;
      wirelessPowered = val.toLowerCase() === "true";
    }
  }

  let batteryPct: number | null = null;
  if (rawLevel !== null) {
    const normalized = scale && scale !== 100 ? Math.round((rawLevel / scale) * 100) : rawLevel;
    if (normalized >= 0 && normalized <= 100) {
      batteryPct = normalized;
    }
  }

  return {
    batteryPct,
    tempC,
    charging: sawPowerField ? acPowered || usbPowered || wirelessPowered : null,
  };
}

/** Parses `xcrun devicectl list devices` text output for connected iOS hardware. */
export function parseDevicectlOutput(stdout: string): ScannedDevice[] {
  const devices: ScannedDevice[] = [];
  const lines = stdout.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("Name") || /^[\s-=]+$/.test(line)) {
      continue;
    }
    const cols = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cols.length < 3) continue;

    // Locate identifier column dynamically in case Hostname is omitted on USB-only devices.
    const idIdx = cols.findIndex((c, idx) => idx >= 1 && /^[0-9a-fA-F-]{8,}$/.test(c));
    if (idIdx < 1) continue;

    const name = cols[0] ?? "iPhone";
    const hostname = idIdx >= 2 ? (cols[1] ?? "") : "";
    const identifier = cols[idIdx] ?? "";
    const stateRaw = (cols[idIdx + 1] ?? "").toLowerCase();
    const model = cols[idIdx + 2] ?? null;

    if (!isValidSerial(identifier)) continue;

    const isIosModel =
      !model ||
      /iphone|ipad|ios/i.test(model) ||
      /iphone|ipad/i.test(name);
    if (!isIosModel) continue;

    const connectionState: ScannedDevice["connectionState"] =
      stateRaw.includes("available") || stateRaw.includes("connected")
        ? "online"
        : stateRaw.includes("unpaired") || stateRaw.includes("locked")
          ? "unauthorized"
          : "offline";

    devices.push({
      platform: "ios",
      serialOrUdid: identifier,
      label: name,
      model,
      connectionState,
      source: "devicectl",
      transportDetails: {
        hostname,
        state: cols[idIdx + 1] ?? "",
      },
    });
  }

  return devices;
}

/** Parses `pymobiledevice3 usbmux list` JSON output for USB-connected iOS devices. */
export function parsePymobiledeviceUsbmuxOutput(stdout: string): ScannedDevice[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    const devices: ScannedDevice[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const udid =
        typeof rec["UniqueDeviceID"] === "string"
          ? rec["UniqueDeviceID"]
          : typeof rec["Identifier"] === "string"
            ? rec["Identifier"]
            : null;
      if (!udid || !isValidSerial(udid)) continue;

      const name =
        typeof rec["DeviceName"] === "string" ? rec["DeviceName"] : `iphone-${udid.slice(-4)}`;
      const model =
        typeof rec["ProductType"] === "string" ? rec["ProductType"] : null;
      const connType =
        typeof rec["ConnectionType"] === "string" ? rec["ConnectionType"] : "USB";

      devices.push({
        platform: "ios",
        serialOrUdid: udid,
        label: name,
        model,
        connectionState: "online",
        source: "pymobiledevice3",
        transportDetails: { connectionType: connType },
      });
    }
    return devices;
  } catch {
    return [];
  }
}

function normalizeAppleBatteryTempC(rawTemp: number): number | null {
  if (!Number.isFinite(rawTemp)) return null;
  // Apple IOPMPowerSource reports centi-degrees Celsius (e.g., 2950 => 29.5 C, 950 => 9.5 C).
  if (rawTemp >= 500) {
    return Math.round((rawTemp / 100) * 10) / 10;
  }
  // Deci-degrees Celsius fallback (e.g., 310 => 31.0 C).
  if (rawTemp > 100) {
    return Math.round((rawTemp / 10) * 10) / 10;
  }
  return Math.round(rawTemp * 10) / 10;
}

/** Parses `pymobiledevice3 diagnostics battery single` JSON or key-value output. */
export function parsePymobiledeviceBatteryOutput(stdout: string): {
  batteryPct: number | null;
  tempC: number | null;
  charging: boolean | null;
} {
  const trimmed = stdout.trim();
  if (!trimmed) return { batteryPct: null, tempC: null, charging: null };

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      const rawPct =
        typeof rec["CurrentCapacity"] === "number"
          ? rec["CurrentCapacity"]
          : typeof rec["BatteryCurrentCapacity"] === "number"
            ? rec["BatteryCurrentCapacity"]
            : null;
      const rawTemp =
        typeof rec["Temperature"] === "number" ? rec["Temperature"] : null;
      const charging =
        typeof rec["IsCharging"] === "boolean"
          ? rec["IsCharging"]
          : typeof rec["BatteryIsCharging"] === "boolean"
            ? rec["BatteryIsCharging"]
            : null;

      return {
        batteryPct: rawPct !== null && rawPct >= 0 && rawPct <= 100 ? Math.round(rawPct) : null,
        tempC: rawTemp !== null ? normalizeAppleBatteryTempC(rawTemp) : null,
        charging,
      };
    }
  } catch {
    // Fall through to key-value line parsing.
  }

  let batteryPct: number | null = null;
  let tempC: number | null = null;
  let charging: boolean | null = null;

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const match = /^\s*"?([A-Za-z0-9_]+)"?\s*[:=]\s*([^,]+),?\s*$/.exec(rawLine);
    if (!match) continue;
    const key = (match[1] ?? "").toLowerCase();
    const val = (match[2] ?? "").replace(/"/g, "").trim();

    if (key === "currentcapacity" || key === "batterycurrentcapacity") {
      const n = Number.parseInt(val, 10);
      if (Number.isFinite(n) && n >= 0 && n <= 100) batteryPct = n;
    } else if (key === "temperature") {
      const n = Number.parseFloat(val);
      if (Number.isFinite(n)) {
        tempC = normalizeAppleBatteryTempC(n);
      }
    } else if (key === "ischarging" || key === "batteryischarging") {
      charging = val.toLowerCase() === "true";
    }
  }

  return { batteryPct, tempC, charging };
}

/** Escapes text for Android `adb shell input text <value>` while stripping control chars and shell metacharacters. */
export function escapeAndroidInputText(text: string): string {
  return stripControlChars(text)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/ /g, "%s")
    .replace(/(["'&|<>()$`!;*?[\]{}~#^])/g, "\\$1");
}

function isAndroidAction(action: DeviceAction): action is AndroidDeviceAction {
  return (
    action.kind === "tap" ||
    action.kind === "text" ||
    action.kind === "swipe" ||
    action.kind === "launch_app" ||
    action.kind === "screenshot" ||
    action.kind === "ui_dump" ||
    action.kind === "scrcpy_cmd"
  );
}

function isIosAction(action: DeviceAction): action is IosDeviceAction {
  return (
    action.kind === "wda_tap" ||
    action.kind === "wda_type" ||
    action.kind === "wda_launch" ||
    action.kind === "wda_screenshot"
  );
}

function validateDeviceAction(serial: string, action: DeviceAction): string | null {
  if (!isValidSerial(serial)) {
    return `Invalid device serialOrUdid: ${serial}`;
  }
  switch (action.kind) {
    case "tap":
    case "wda_tap":
      if (!isValidCoord(action.x) || !isValidCoord(action.y)) {
        return `Invalid coordinates for ${action.kind}: (${String(action.x)}, ${String(action.y)})`;
      }
      return null;
    case "text":
      if (typeof action.text !== "string" || action.text.length === 0 || action.text.length > MAX_TEXT_LENGTH) {
        return `Android text action requires a non-empty string up to ${MAX_TEXT_LENGTH} chars.`;
      }
      if (hasControlChars(action.text)) {
        return "Android text action rejects control characters (\\n, \\r, \\0, etc.) to prevent shell injection.";
      }
      return null;
    case "wda_type":
      if (typeof action.text !== "string" || action.text.length === 0 || action.text.length > MAX_TEXT_LENGTH) {
        return `iOS wda_type action requires a non-empty string up to ${MAX_TEXT_LENGTH} chars.`;
      }
      if (hasControlChars(action.text)) {
        return "iOS wda_type action rejects control characters.";
      }
      return null;
    case "swipe":
      if (
        !isValidCoord(action.x1) ||
        !isValidCoord(action.y1) ||
        !isValidCoord(action.x2) ||
        !isValidCoord(action.y2)
      ) {
        return "Invalid coordinates for swipe action.";
      }
      if (
        action.durationMs !== undefined &&
        (!Number.isFinite(action.durationMs) || action.durationMs < 50 || action.durationMs > 10_000)
      ) {
        return "Invalid durationMs for swipe action (must be 50..10000).";
      }
      return null;
    case "launch_app":
      if (!isValidPackageName(action.packageName)) {
        return `Invalid Android packageName: ${action.packageName}`;
      }
      if (action.activity !== undefined && !isValidActivity(action.activity)) {
        return `Invalid Android activity: ${action.activity}`;
      }
      return null;
    case "screenshot": {
      const target = action.outputPath ?? "/sdcard/marketing-screen.png";
      if (!isValidOutputPath(target)) {
        return `Invalid screenshot outputPath (must be under /sdcard/ or /tmp/ with safe characters): ${target}`;
      }
      return null;
    }
    case "ui_dump": {
      const target = action.outputPath ?? "/sdcard/marketing-ui.xml";
      if (!isValidOutputPath(target)) {
        return `Invalid ui_dump outputPath (must be under /sdcard/ or /tmp/ with safe characters): ${target}`;
      }
      return null;
    }
    case "scrcpy_cmd":
      return validateScrcpyArgs(action.args);
    case "wda_launch":
      if (!BUNDLE_ID_RE.test(action.bundleId) || action.bundleId.startsWith("-")) {
        return `Invalid iOS bundleId: ${action.bundleId}`;
      }
      return null;
    case "wda_screenshot":
      return null;
  }
}

function buildAndroidCommand(serial: string, action: AndroidDeviceAction): string[] {
  switch (action.kind) {
    case "tap":
      return [
        "adb",
        "-s",
        serial,
        "shell",
        "input",
        "tap",
        String(Math.round(action.x)),
        String(Math.round(action.y)),
      ];
    case "text":
      return [
        "adb",
        "-s",
        serial,
        "shell",
        "input",
        "text",
        escapeAndroidInputText(action.text),
      ];
    case "swipe":
      return [
        "adb",
        "-s",
        serial,
        "shell",
        "input",
        "swipe",
        String(Math.round(action.x1)),
        String(Math.round(action.y1)),
        String(Math.round(action.x2)),
        String(Math.round(action.y2)),
        String(Math.max(50, Math.round(action.durationMs ?? 300))),
      ];
    case "launch_app":
      if (action.activity) {
        return [
          "adb",
          "-s",
          serial,
          "shell",
          "am",
          "start",
          "-n",
          `${action.packageName}/${action.activity}`,
        ];
      }
      return [
        "adb",
        "-s",
        serial,
        "shell",
        "monkey",
        "-p",
        action.packageName,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ];
    case "screenshot": {
      const target = action.outputPath ?? "/sdcard/marketing-screen.png";
      return ["adb", "-s", serial, "shell", "screencap", "-p", target];
    }
    case "ui_dump": {
      const target = action.outputPath ?? "/sdcard/marketing-ui.xml";
      return ["adb", "-s", serial, "shell", "uiautomator", "dump", target];
    }
    case "scrcpy_cmd":
      return [
        "scrcpy",
        "--serial",
        serial,
        "--window-title",
        `ntwrk-${serial}`,
        ...(action.args ?? []),
      ];
  }
}

/** Converts a ScannedDevice into a DeviceNode suitable for MarketingStore registration. */
export function toDeviceNode(
  scanned: ScannedDevice,
  clock: Clock = createDefaultClock(),
  overrides?: Partial<DeviceNode>,
): DeviceNode {
  const warmupDay = overrides?.warmupDay ?? 0;
  const nowIso = new Date(clock.now()).toISOString();
  return {
    id: overrides?.id ?? `${scanned.platform}-${scanned.serialOrUdid}`,
    label: overrides?.label ?? scanned.label,
    platform: scanned.platform,
    hostMachine: overrides?.hostMachine ?? "local-macbook",
    serialOrUdid: scanned.serialOrUdid,
    assignedPersona: overrides?.assignedPersona ?? null,
    simCarrier: overrides?.simCarrier ?? null,
    batteryPct: overrides?.batteryPct ?? 55,
    tempC: overrides?.tempC ?? 32,
    warmupDay,
    warmupStage: overrides?.warmupStage ?? deriveWarmupStage(warmupDay),
    dailyActionsUsed: overrides?.dailyActionsUsed ?? 0,
    dailyActionCap: overrides?.dailyActionCap ?? warmupDailyCap(warmupDay),
    leaseHolder: overrides?.leaseHolder ?? null,
    leaseExpiresAt: overrides?.leaseExpiresAt ?? null,
    status:
      overrides?.status ??
      (scanned.connectionState === "online" ? "online" : "offline"),
    lastSeenAt: overrides?.lastSeenAt ?? nowIso,
  };
}

/**
 * Tier-2 MacBook physical device controller for 1 Android + 1 iPhone (or N phones).
 * Uses injectable command/HTTP/clock dependencies so integration tests run cleanly
 * without attached USB hardware.
 */
export class DeviceBridge {
  private readonly exec: ExecFn;
  private readonly usingDefaultExec: boolean;
  private readonly findExecutableFn: FindExecutableFn | null;
  private readonly fetchFn: FetchFn;
  private readonly clock: Clock;
  private readonly env: Record<string, string | undefined>;
  private readonly hostMachine: string;
  private readonly wdaBaseUrl: string;
  private readonly execTimeoutMs: number;

  constructor(opts?: DeviceBridgeOptions) {
    this.usingDefaultExec = opts?.exec === undefined;
    this.exec = opts?.exec ?? defaultProcessExec;
    this.findExecutableFn = opts?.findExecutable ?? null;
    this.fetchFn = opts?.fetchFn ?? fetch;
    this.clock = opts?.clock ?? createDefaultClock();
    this.env = opts?.env ?? process.env;
    this.hostMachine = opts?.hostMachine ?? "local-macbook";
    const candidateWda = (
      opts?.wdaBaseUrl ??
      this.env["MARKETING_WDA_URL"] ??
      DEFAULT_WDA_URL
    ).replace(/\/+$/, "");
    this.wdaBaseUrl = isLoopbackUrl(candidateWda) ? candidateWda : DEFAULT_WDA_URL;
    this.execTimeoutMs =
      opts?.execTimeoutMs !== undefined &&
      Number.isFinite(opts.execTimeoutMs) &&
      opts.execTimeoutMs > 0
        ? Math.round(opts.execTimeoutMs)
        : DEFAULT_EXEC_TIMEOUT_MS;
  }

  private runCmd(cmd: string[], timeoutMs = this.execTimeoutMs): Promise<ExecResult> {
    return this.exec(cmd, { timeoutMs });
  }

  isLiveDeviceEnabled(): boolean {
    return this.env["MARKETING_LIVE_DEVICE"] === "1";
  }

  /** Probes WebDriverAgent `/status` endpoint on loopback. */
  async probeWdaStatus(baseUrl?: string): Promise<{
    reachable: boolean;
    sessionId: string | null;
    osVersion: string | null;
  }> {
    const resolvedBase = (baseUrl ?? this.wdaBaseUrl).replace(/\/+$/, "");
    if (!isLoopbackUrl(resolvedBase)) {
      return { reachable: false, sessionId: null, osVersion: null };
    }
    const url = `${resolvedBase}/status`;
    try {
      const res = await this.fetchFn(url, {
        method: "GET",
        signal: AbortSignal.timeout(DEFAULT_WDA_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { reachable: false, sessionId: null, osVersion: null };
      }
      const body = (await res.json()) as Record<string, unknown>;
      const sessionId =
        typeof body["sessionId"] === "string" ? body["sessionId"] : null;
      const value =
        body["value"] && typeof body["value"] === "object"
          ? (body["value"] as Record<string, unknown>)
          : null;
      const osObj =
        value?.["os"] && typeof value["os"] === "object"
          ? (value["os"] as Record<string, unknown>)
          : null;
      const osVersion =
        typeof osObj?.["version"] === "string" ? osObj["version"] : null;
      return { reachable: true, sessionId, osVersion };
    } catch {
      return { reachable: false, sessionId: null, osVersion: null };
    }
  }

  /**
   * Scans USB-attached Android (`adb devices -l`) and iOS (`xcrun devicectl list devices`
   * + `pymobiledevice3 usbmux list` + WebDriverAgent `/status`) devices with graceful fallback.
   */
  async scanConnectedDevices(): Promise<DeviceScanResult> {
    const scannedAt = new Date(this.clock.now()).toISOString();
    const warnings: string[] = [];
    const bySerial = new Map<string, ScannedDevice>();

    const [adbRes, devicectlRes, pymdRes, wdaStatus] = await Promise.all([
      this.runCmd(["adb", "devices", "-l"]),
      this.runCmd(["xcrun", "devicectl", "list", "devices"]),
      this.runCmd(["pymobiledevice3", "usbmux", "list"]),
      this.probeWdaStatus(),
    ]);

    if (adbRes.exitCode === 0) {
      for (const dev of parseAdbDevicesOutput(adbRes.stdout)) {
        bySerial.set(`android:${dev.serialOrUdid}`, dev);
      }
    } else {
      warnings.push(
        `adb scan unavailable (exit ${adbRes.exitCode}): ${adbRes.stderr.trim() || "binary not installed or server stopped"}`,
      );
    }

    if (devicectlRes.exitCode === 0) {
      for (const dev of parseDevicectlOutput(devicectlRes.stdout)) {
        bySerial.set(`ios:${dev.serialOrUdid}`, dev);
      }
    } else {
      warnings.push(
        `xcrun devicectl scan unavailable (exit ${devicectlRes.exitCode}): ${devicectlRes.stderr.trim() || "Xcode CLI tools not installed"}`,
      );
    }

    if (pymdRes.exitCode === 0) {
      for (const dev of parsePymobiledeviceUsbmuxOutput(pymdRes.stdout)) {
        const key = `ios:${dev.serialOrUdid}`;
        if (!bySerial.has(key)) {
          bySerial.set(key, dev);
        }
      }
    } else {
      warnings.push(
        `pymobiledevice3 usbmux scan unavailable (exit ${pymdRes.exitCode}): ${pymdRes.stderr.trim() || "pymobiledevice3 not installed"}`,
      );
    }

    const devices = Array.from(bySerial.values());
    const iosCount = devices.filter((d) => d.platform === "ios").length;

    if (wdaStatus.reachable && iosCount === 0) {
      devices.push({
        platform: "ios",
        serialOrUdid: wdaStatus.sessionId ?? "wda-local-ios",
        label: "iphone-wda-local",
        model: wdaStatus.osVersion ? `iOS ${wdaStatus.osVersion}` : "iPhone (WDA)",
        connectionState: "online",
        source: "wda",
        transportDetails: {
          wdaBaseUrl: this.wdaBaseUrl,
        },
      });
    }

    return {
      hostMachine: this.hostMachine,
      scannedAt,
      devices,
      androidCount: devices.filter((d) => d.platform === "android").length,
      iosCount: devices.filter((d) => d.platform === "ios").length,
      wdaReachable: wdaStatus.reachable,
      warnings,
    };
  }

  /**
   * Polls real Android (`adb -s <serial> shell dumpsys battery`) or iOS
   * (`pymobiledevice3 diagnostics battery single` / WDA `/wda/batteryInfo`) telemetry
   * and evaluates proved `deviceBatterySafe` and `warmupDailyCap` from `marketingDevice.ts`.
   */
  async pollDeviceTelemetry(device: DeviceNode): Promise<DeviceTelemetryResult> {
    const polledAt = new Date(this.clock.now()).toISOString();
    const dailyActionCap = warmupDailyCap(device.warmupDay);
    const warmupStage = deriveWarmupStage(device.warmupDay);

    if (!isValidSerial(device.serialOrUdid)) {
      const fallbackSafe = deviceBatterySafe(device.batteryPct, device.tempC);
      return {
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        reachable: false,
        batteryPct: device.batteryPct,
        tempC: device.tempC,
        charging: null,
        batterySafe: fallbackSafe,
        warmupDay: device.warmupDay,
        warmupStage,
        dailyActionCap,
        recommendedStatus: "offline",
        polledAt,
        source: "cached_fallback",
        error: `Invalid device serialOrUdid: ${device.serialOrUdid}`,
      };
    }

    if (device.platform === "android") {
      const res = await this.runCmd([
        "adb",
        "-s",
        device.serialOrUdid,
        "shell",
        "dumpsys",
        "battery",
      ]);

      if (res.exitCode === 0) {
        const parsed = parseAdbBatteryOutput(res.stdout);
        if (parsed.batteryPct !== null) {
          const batteryPct = parsed.batteryPct;
          const tempC = parsed.tempC ?? device.tempC;
          const batterySafe = deviceBatterySafe(batteryPct, tempC);
          return {
            deviceId: device.id,
            serialOrUdid: device.serialOrUdid,
            platform: device.platform,
            reachable: true,
            batteryPct,
            tempC,
            charging: parsed.charging,
            batterySafe,
            warmupDay: device.warmupDay,
            warmupStage,
            dailyActionCap,
            recommendedStatus: deriveDeviceTelemetryStatus(
              true,
              batteryPct,
              tempC,
              device.status,
            ),
            polledAt,
            source: "adb_dumpsys",
            error: null,
          };
        }
      }

      const fallbackSafe = deviceBatterySafe(device.batteryPct, device.tempC);
      return {
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        reachable: false,
        batteryPct: device.batteryPct,
        tempC: device.tempC,
        charging: null,
        batterySafe: fallbackSafe,
        warmupDay: device.warmupDay,
        warmupStage,
        dailyActionCap,
        recommendedStatus: "offline",
        polledAt,
        source: "cached_fallback",
        error: res.stderr.trim() || `adb dumpsys battery failed (exit ${res.exitCode})`,
      };
    }

    const pymdRes = await this.runCmd([
      "pymobiledevice3",
      "diagnostics",
      "battery",
      "single",
      "--udid",
      device.serialOrUdid,
    ]);

    if (pymdRes.exitCode === 0) {
      const parsed = parsePymobiledeviceBatteryOutput(pymdRes.stdout);
      if (parsed.batteryPct !== null) {
        const batteryPct = parsed.batteryPct;
        const tempC = parsed.tempC ?? device.tempC;
        const batterySafe = deviceBatterySafe(batteryPct, tempC);
        return {
          deviceId: device.id,
          serialOrUdid: device.serialOrUdid,
          platform: device.platform,
          reachable: true,
          batteryPct,
          tempC,
          charging: parsed.charging,
          batterySafe,
          warmupDay: device.warmupDay,
          warmupStage,
          dailyActionCap,
          recommendedStatus: deriveDeviceTelemetryStatus(
            true,
            batteryPct,
            tempC,
            device.status,
          ),
          polledAt,
          source: "pymobiledevice3",
          error: null,
        };
      }
    }

    try {
      const wdaStatus = await this.probeWdaStatus();
      if (wdaStatus.reachable && wdaStatus.sessionId) {
        const wdaRes = await this.fetchFn(
          `${this.wdaBaseUrl}/session/${encodeURIComponent(wdaStatus.sessionId)}/wda/batteryInfo`,
          {
            method: "GET",
            signal: AbortSignal.timeout(DEFAULT_WDA_TIMEOUT_MS),
          },
        );
        if (wdaRes.ok) {
          const payload = (await wdaRes.json()) as Record<string, unknown>;
          const value =
            payload["value"] && typeof payload["value"] === "object"
              ? (payload["value"] as Record<string, unknown>)
              : null;
          const level = typeof value?.["level"] === "number" ? value["level"] : null;
          const state = typeof value?.["state"] === "number" ? value["state"] : null;
          if (level !== null && Number.isFinite(level) && level >= 0) {
            const batteryPct =
              level <= 1 ? Math.round(level * 100) : Math.min(100, Math.round(level));
            const tempC = device.tempC;
            const batterySafe = deviceBatterySafe(batteryPct, tempC);
            return {
              deviceId: device.id,
              serialOrUdid: device.serialOrUdid,
              platform: device.platform,
              reachable: true,
              batteryPct,
              tempC,
              charging: state === 2 || state === 3,
              batterySafe,
              warmupDay: device.warmupDay,
              warmupStage,
              dailyActionCap,
              recommendedStatus: deriveDeviceTelemetryStatus(
                true,
                batteryPct,
                tempC,
                device.status,
              ),
              polledAt,
              source: "wda",
              error: null,
            };
          }
        }
      }
    } catch {
      // Fall through to cached fallback below.
    }

    const fallbackSafe = deviceBatterySafe(device.batteryPct, device.tempC);
    return {
      deviceId: device.id,
      serialOrUdid: device.serialOrUdid,
      platform: device.platform,
      reachable: false,
      batteryPct: device.batteryPct,
      tempC: device.tempC,
      charging: null,
      batterySafe: fallbackSafe,
      warmupDay: device.warmupDay,
      warmupStage,
      dailyActionCap,
      recommendedStatus: "offline",
      polledAt,
      source: "cached_fallback",
      error:
        pymdRes.stderr.trim() ||
        `iOS battery telemetry unavailable (pymobiledevice3 exit ${pymdRes.exitCode}, WDA unreachable)`,
    };
  }

  /**
   * Executes one Android or iOS device action.
   * Strictly checks proved `canDispatchDeviceStep(...)` via `evaluateDeviceActionPolicy`
   * BEFORE dispatching any subprocess or HTTP request.
   * Stays in safe dry-run mode unless `MARKETING_LIVE_DEVICE === "1"` AND `context.dryRun !== true`.
   */
  async executeDeviceAction(
    device: DeviceNode,
    action: DeviceAction,
    context: DeviceActionContext,
  ): Promise<DeviceExecutionResult> {
    const nowMs = this.clock.now();
    const executedAt = new Date(nowMs).toISOString();
    const wdaBase = (context.wdaBaseUrl ?? this.wdaBaseUrl).replace(/\/+$/, "");

    const leasedByOther = isDeviceLeaseHeldByOther(device, context.leaseHolder, nowMs);

    const safetyInput: DeviceActionInput = {
      deviceOnline: device.status === "online" || device.status === "leased",
      leasedByOther,
      batteryPct: device.batteryPct,
      tempC: device.tempC,
      actionsToday: device.dailyActionsUsed,
      warmupDay: device.warmupDay,
      lockdown: context.lockdown,
      targetStopped: context.targetStopped,
    };

    const liveAllowed = this.isLiveDeviceEnabled() && context.dryRun !== true;
    const effectiveDryRun = !liveAllowed;

    const validationError = validateDeviceAction(device.serialOrUdid, action);
    if (validationError) {
      return {
        ok: false,
        executed: false,
        dryRun: effectiveDryRun,
        status: "failed",
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        action,
        commandPreview: `${action.kind} (rejected)`,
        output: null,
        reason: validationError,
        safetyInput,
        executedAt,
      };
    }

    if (isIosAction(action) && !isLoopbackUrl(wdaBase)) {
      return {
        ok: false,
        executed: false,
        dryRun: effectiveDryRun,
        status: "failed",
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        action,
        commandPreview: `${action.kind} -> (rejected non-loopback WDA URL)`,
        output: null,
        reason: "WebDriverAgent URL must target a loopback host (127.0.0.1, localhost, or ::1).",
        safetyInput,
        executedAt,
      };
    }

    const commandPreview = isAndroidAction(action)
      ? buildAndroidCommand(device.serialOrUdid, action).join(" ")
      : `${action.kind} -> ${wdaBase}`;

    const policyDecision = evaluateDeviceActionPolicy({
      device,
      leaseHolder: context.leaseHolder,
      nowMs,
      lockdown: context.lockdown,
      targetStopped: context.targetStopped,
      challengeDetected: context.challengeDetected,
    });

    if (policyDecision.needsTakeover) {
      return {
        ok: false,
        executed: false,
        dryRun: effectiveDryRun,
        status: "needs_takeover",
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        action,
        commandPreview,
        output: null,
        reason:
          "Login challenge, CAPTCHA, or 2FA detected: halted for human takeover (never bypassed).",
        safetyInput,
        executedAt,
      };
    }

    if (
      (device.platform === "android" && !isAndroidAction(action)) ||
      (device.platform === "ios" && !isIosAction(action)) ||
      (device.platform !== "android" && device.platform !== "ios")
    ) {
      return {
        ok: false,
        executed: false,
        dryRun: effectiveDryRun,
        status: "failed",
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        action,
        commandPreview,
        output: null,
        reason: `Action '${action.kind}' is not valid for ${device.platform} device '${device.id}'.`,
        safetyInput,
        executedAt,
      };
    }

    if (!policyDecision.allowed) {
      return {
        ok: false,
        executed: false,
        dryRun: effectiveDryRun,
        status: "blocked_safety",
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        action,
        commandPreview,
        output: null,
        reason: policyDecision.reason ?? "blocked by device safety core",
        safetyInput,
        executedAt,
      };
    }

    if (effectiveDryRun) {
      const dryReason = !this.isLiveDeviceEnabled()
        ? "Dry-run mode (set MARKETING_LIVE_DEVICE=1 to dispatch to physical phone)."
        : "Dry-run mode requested by caller.";
      return {
        ok: true,
        executed: false,
        dryRun: true,
        status: "completed",
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        action,
        commandPreview,
        output: commandPreview,
        reason: dryReason,
        safetyInput,
        executedAt,
      };
    }

    if (isAndroidAction(action)) {
      const cmd = buildAndroidCommand(device.serialOrUdid, action);
      const res = await this.runCmd(cmd);
      if (res.exitCode !== 0) {
        return {
          ok: false,
          executed: true,
          dryRun: false,
          status: "failed",
          deviceId: device.id,
          serialOrUdid: device.serialOrUdid,
          platform: device.platform,
          action,
          commandPreview,
          output: res.stdout || null,
          reason: res.stderr.trim() || `Command exited with code ${res.exitCode}`,
          safetyInput,
          executedAt,
        };
      }
      return {
        ok: true,
        executed: true,
        dryRun: false,
        status: "completed",
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        action,
        commandPreview,
        output: res.stdout.trim() || "ok",
        reason: "Executed on physical Android device.",
        safetyInput,
        executedAt,
      };
    }

    return this.executeIosWdaAction(
      device,
      action,
      wdaBase,
      context.wdaSessionId ?? null,
      safetyInput,
      commandPreview,
      executedAt,
    );
  }

  private async executeIosWdaAction(
    device: DeviceNode,
    action: IosDeviceAction,
    wdaBase: string,
    providedSessionId: string | null,
    safetyInput: DeviceActionInput,
    commandPreview: string,
    executedAt: string,
  ): Promise<DeviceExecutionResult> {
    let createdEphemeralSessionId: string | null = null;
    try {
      let sessionId = providedSessionId;
      if (!sessionId) {
        const status = await this.probeWdaStatus(wdaBase);
        sessionId = status.sessionId;
      }
      if (!sessionId) {
        const createRes = await this.fetchFn(`${wdaBase}/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ capabilities: {} }),
          signal: AbortSignal.timeout(DEFAULT_WDA_TIMEOUT_MS),
        });
        if (!createRes.ok) {
          return {
            ok: false,
            executed: true,
            dryRun: false,
            status: "failed",
            deviceId: device.id,
            serialOrUdid: device.serialOrUdid,
            platform: device.platform,
            action,
            commandPreview,
            output: null,
            reason: `WDA session creation failed (HTTP ${createRes.status}).`,
            safetyInput,
            executedAt,
          };
        }
        const created = (await createRes.json()) as Record<string, unknown>;
        sessionId =
          typeof created["sessionId"] === "string"
            ? created["sessionId"]
            : created["value"] &&
                typeof created["value"] === "object" &&
                typeof (created["value"] as Record<string, unknown>)["sessionId"] === "string"
              ? ((created["value"] as Record<string, unknown>)["sessionId"] as string)
              : null;
        createdEphemeralSessionId = sessionId;
      }

      if (!sessionId) {
        return {
          ok: false,
          executed: true,
          dryRun: false,
          status: "failed",
          deviceId: device.id,
          serialOrUdid: device.serialOrUdid,
          platform: device.platform,
          action,
          commandPreview,
          output: null,
          reason: "Unable to resolve WebDriverAgent sessionId.",
          safetyInput,
          executedAt,
        };
      }

      const encodedSession = encodeURIComponent(sessionId);
      let endpoint = "";
      let method: "GET" | "POST" = "POST";
      let payload: Record<string, unknown> | undefined;

      switch (action.kind) {
        case "wda_tap":
          endpoint = `${wdaBase}/session/${encodedSession}/wda/tap/0`;
          payload = { x: Math.round(action.x), y: Math.round(action.y) };
          break;
        case "wda_type":
          endpoint = `${wdaBase}/session/${encodedSession}/wda/keys`;
          payload = { value: Array.from(action.text) };
          break;
        case "wda_launch":
          endpoint = `${wdaBase}/session/${encodedSession}/wda/apps/launch`;
          payload = { bundleId: action.bundleId };
          break;
        case "wda_screenshot":
          endpoint = `${wdaBase}/session/${encodedSession}/screenshot`;
          method = "GET";
          break;
      }

      const res = await this.fetchFn(endpoint, {
        method,
        headers: payload ? { "content-type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(DEFAULT_WDA_TIMEOUT_MS),
      });

      const responseText = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          executed: true,
          dryRun: false,
          status: "failed",
          deviceId: device.id,
          serialOrUdid: device.serialOrUdid,
          platform: device.platform,
          action,
          commandPreview,
          output: responseText || null,
          reason: `WDA ${action.kind} failed (HTTP ${res.status}).`,
          safetyInput,
          executedAt,
        };
      }

      return {
        ok: true,
        executed: true,
        dryRun: false,
        status: "completed",
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        action,
        commandPreview,
        output: responseText.slice(0, 512) || "ok",
        reason: "Executed on physical iOS device via WebDriverAgent.",
        safetyInput,
        executedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        executed: true,
        dryRun: false,
        status: "failed",
        deviceId: device.id,
        serialOrUdid: device.serialOrUdid,
        platform: device.platform,
        action,
        commandPreview,
        output: null,
        reason: `WDA request error: ${message}`,
        safetyInput,
        executedAt,
      };
    } finally {
      if (createdEphemeralSessionId) {
        try {
          await this.fetchFn(
            `${wdaBase}/session/${encodeURIComponent(createdEphemeralSessionId)}`,
            {
              method: "DELETE",
              signal: AbortSignal.timeout(2_000),
            },
          );
        } catch {
          // Best-effort cleanup of ephemeral WDA session.
        }
      }
    }
  }

  /**
   * Inspects local MacBook readiness for `adb`, `scrcpy`, `xcrun`, `pymobiledevice3`,
   * and WebDriverAgent so the Command Center UI can render actionable setup guidance.
   */
  async buildSetupDiagnostics(): Promise<SetupDiagnostics> {
    const checkedAt = new Date(this.clock.now()).toISOString();

    const specs: Array<{
      tool: ToolDiagnostic["tool"];
      platform: DevicePlatform;
      required: boolean;
      versionCmd: string[];
      installHint: string;
    }> = [
      {
        tool: "adb",
        platform: "android",
        required: true,
        versionCmd: ["adb", "--version"],
        installHint: "brew install android-platform-tools",
      },
      {
        tool: "scrcpy",
        platform: "android",
        required: false,
        versionCmd: ["scrcpy", "--version"],
        installHint: "brew install scrcpy",
      },
      {
        tool: "xcrun",
        platform: "ios",
        required: true,
        versionCmd: ["xcrun", "--version"],
        installHint: "xcode-select --install",
      },
      {
        tool: "pymobiledevice3",
        platform: "ios",
        required: true,
        versionCmd: ["pymobiledevice3", "version"],
        installHint: "pipx install pymobiledevice3 (or python3 -m pip install pymobiledevice3)",
      },
    ];

    const [toolResults, wdaStatus] = await Promise.all([
      Promise.all(
        specs.map(async (spec): Promise<ToolDiagnostic> => {
          const foundPath = this.findExecutableFn
            ? this.findExecutableFn(spec.tool)
            : this.usingDefaultExec
              ? findExecutable(spec.tool)
              : await this.runCmd(["which", spec.tool]).then((r) =>
                  r.exitCode === 0 ? r.stdout.trim() || null : null,
                );
          if (!foundPath) {
            return {
              tool: spec.tool,
              platform: spec.platform,
              required: spec.required,
              status: "missing",
              path: null,
              version: null,
              installHint: spec.installHint,
            };
          }
          const verRes = await this.runCmd(spec.versionCmd);
          const firstLine =
            (verRes.stdout || verRes.stderr).split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ??
            null;
          return {
            tool: spec.tool,
            platform: spec.platform,
            required: spec.required,
            status: verRes.exitCode === 0 ? "ready" : "missing",
            path: foundPath,
            version: firstLine,
            installHint: spec.installHint,
          };
        }),
      ),
      this.probeWdaStatus(),
    ]);

    const byTool = new Map(toolResults.map((t) => [t.tool, t]));
    const androidReady = byTool.get("adb")?.status === "ready";
    const iosReady =
      byTool.get("xcrun")?.status === "ready" ||
      byTool.get("pymobiledevice3")?.status === "ready" ||
      wdaStatus.reachable;

    const nextSteps: string[] = [];
    for (const tool of toolResults) {
      if (tool.status === "missing") {
        nextSteps.push(`Install ${tool.tool} (${tool.platform}): ${tool.installHint}`);
      }
    }
    if (!wdaStatus.reachable) {
      nextSteps.push(
        `Start prebuilt WebDriverAgent on iPhone and forward port 8100 (${this.wdaBaseUrl}/status) for live iOS actions.`,
      );
    }
    if (!this.isLiveDeviceEnabled()) {
      nextSteps.push(
        "Device actions currently run in safe dry-run mode; set MARKETING_LIVE_DEVICE=1 when phones are connected on cellular SIMs (Wi-Fi OFF).",
      );
    }

    return {
      hostMachine: this.hostMachine,
      checkedAt,
      liveDeviceEnabled: this.isLiveDeviceEnabled(),
      androidReady,
      iosReady,
      wdaReachable: wdaStatus.reachable,
      wdaBaseUrl: this.wdaBaseUrl,
      tools: toolResults,
      nextSteps,
    };
  }
}

export function scanConnectedDevices(
  opts?: DeviceBridgeOptions,
): Promise<DeviceScanResult> {
  return new DeviceBridge(opts).scanConnectedDevices();
}

export function pollDeviceTelemetry(
  device: DeviceNode,
  opts?: DeviceBridgeOptions,
): Promise<DeviceTelemetryResult> {
  return new DeviceBridge(opts).pollDeviceTelemetry(device);
}

export function executeDeviceAction(
  device: DeviceNode,
  action: DeviceAction,
  context: DeviceActionContext,
  opts?: DeviceBridgeOptions,
): Promise<DeviceExecutionResult> {
  return new DeviceBridge(opts).executeDeviceAction(device, action, context);
}

export function buildSetupDiagnostics(
  opts?: DeviceBridgeOptions,
): Promise<SetupDiagnostics> {
  return new DeviceBridge(opts).buildSetupDiagnostics();
}
