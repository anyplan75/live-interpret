const { spawnSync } = require("child_process");

// RtAudio reads CoreAudio names with CFStringGetSystemEncoding(), so Korean
// becomes replacement characters. osascript could not be relied on: a throw
// there kept those RtAudio strings and showed no error. system_profiler is
// on every Mac and prints UTF-8. A real SPAudioDataType report looks like:
// { "SPAudioDataType": [ { "_name": "coreaudio_device", "_items": [
//   { "_name": "MacBook Pro Microphone", "coreaudio_device_manufacturer": "Apple Inc." }
// ] } ] }
const SYSTEM_PROFILER = "/usr/sbin/system_profiler";
const PROFILER_ARGS = ["SPAudioDataType", "-json"];
const PROFILER_TIMEOUT_MS = 15000;
const MAC_AUDIO_NAME_NOTE = "마이크 이름을 시스템 오디오 정보에서 읽지 못했습니다.";

let cachedLabels = null;

function resetMacAudioNameCache() {
  cachedLabels = null;
}

function inputCount(device) {
  const count = Number(device && device.coreaudio_device_input);
  return Number.isFinite(count) ? count : 0;
}

function profilerDeviceLabel(device) {
  // A MacBook Pro report lists both "MacBook Pro 마이크" and
  // "MacBook Pro 스피커". Their ASCII keys match, but the speaker has no
  // input count. Only inputs may compete, or the mic stays garbled.
  if (!device || inputCount(device) <= 0) return "";
  if (typeof device._name !== "string" || device._name.length === 0) return "";
  if (typeof device.coreaudio_device_manufacturer !== "string" || device.coreaudio_device_manufacturer.length === 0) return "";
  return `${device.coreaudio_device_manufacturer}: ${device._name}`;
}

function isAudioReport(parsed) {
  if (Array.isArray(parsed)) return true;
  if (!parsed || typeof parsed !== "object") return false;
  if (Array.isArray(parsed.SPAudioDataType)) return true;
  if (Array.isArray(parsed._items)) return true;
  return false;
}

function collectProfilerDevices(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectProfilerDevices(item, out));
    return;
  }
  const label = profilerDeviceLabel(node);
  if (label) out.push(label);
  if (Array.isArray(node._items)) collectProfilerDevices(node._items, out);
  if (node.SPAudioDataType) collectProfilerDevices(node.SPAudioDataType, out);
}

function dedupedLabels(labels) {
  const seen = new Set();
  const out = [];
  (labels || []).forEach((label) => {
    if (typeof label !== "string" || !label || seen.has(label)) return;
    seen.add(label);
    out.push(label);
  });
  return out;
}

function labelsFromProfilerReport(report) {
  const parsed = typeof report === "string" ? JSON.parse(report) : report;
  if (!isAudioReport(parsed)) throw new Error("profiler");
  const labels = [];
  collectProfilerDevices(parsed, labels);
  return dedupedLabels(labels);
}

function letterKey(name) {
  return String(name || "").replace(/[^0-9A-Za-z]/g, "").toLowerCase();
}

function uniqueLabelByLetterKey(labels) {
  const groups = new Map();
  dedupedLabels(labels).forEach((label) => {
    const key = letterKey(label);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(label);
  });
  const unique = new Map();
  groups.forEach((list, key) => {
    if (list.length === 1) unique.set(key, list[0]);
  });
  return unique;
}

function listedDeviceNames(devices, platform, utf8LabelList) {
  if (platform !== "darwin") return devices;
  if (!Array.isArray(devices)) return devices;
  const byLetter = uniqueLabelByLetterKey(utf8LabelList);
  let changed = false;
  const next = devices.map((device) => {
    if (!device) return device;
    const key = letterKey(device.name);
    if (!key || !byLetter.has(key)) return device;
    const name = byLetter.get(key);
    if (name === device.name) return device;
    changed = true;
    return { ...device, name };
  });
  return changed ? next : devices;
}

function readProfilerLabels(spawnImpl) {
  const run = typeof spawnImpl === "function" ? spawnImpl : spawnSync;
  let result;
  try {
    result = run(SYSTEM_PROFILER, PROFILER_ARGS, {
      encoding: "utf8",
      timeout: PROFILER_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (_) {
    throw new Error("profiler");
  }
  if (!result || result.error || result.status !== 0) throw new Error("profiler");
  return labelsFromProfilerReport(result.stdout);
}

function macAudioLabels(platform, spawnImpl) {
  if (platform !== "darwin") return { labels: [], note: null };
  if (cachedLabels) return { labels: cachedLabels, note: null };
  try {
    const labels = readProfilerLabels(spawnImpl);
    cachedLabels = labels;
    return { labels, note: null };
  } catch (_) {
    return { labels: [], note: MAC_AUDIO_NAME_NOTE };
  }
}

function macInputNameResult(devices, platform, spawnImpl) {
  const looked = macAudioLabels(platform, spawnImpl);
  return {
    devices: listedDeviceNames(devices, platform, looked.labels),
    note: looked.note,
  };
}

module.exports = {
  MAC_AUDIO_NAME_NOTE,
  PROFILER_TIMEOUT_MS,
  labelsFromProfilerReport,
  listedDeviceNames,
  macAudioLabels,
  macInputNameResult,
  resetMacAudioNameCache,
};
