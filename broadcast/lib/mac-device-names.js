const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// audify 1.10.1 vendors thestk/rtaudio @ 40e0d814. RtApi::RtApi sets
// currentDeviceId_ = 129, and RtApiCore::probeDevices stores the real
// AudioDeviceID in a private vector while publishing
// info.ID = currentDeviceId_++. audify copies that ID to device.id
// (src/rt_audio_converter.cpp). It is not the CoreAudio AudioDeviceID.
// A fresh RtAudio() — listInputDevices constructs one per call — numbers
// successfully probed kAudioHardwarePropertyDevices entries from 129.
const RTAUDIO_FIRST_DEVICE_ID = 129;

// kAudioDevicePropertyDeviceNameCFString and kAudioObjectPropertyName are
// both 'lnam'. RtAudio already reads that CFString, then calls
// CFStringGetCString with CFStringGetSystemEncoding(), which is not UTF-8,
// so Korean becomes replacement characters. This lookup reads the same
// CFString (and 'lmak' for the manufacturer) as UTF-8.
const COREAUDIO_SCRIPT = String.raw`
ObjC.import("CoreAudio");
ObjC.import("Foundation");
ObjC.import("CoreFoundation");
ObjC.import("stdlib");

var SEL_DEVICES = 0x64657623;
var SEL_NAME = 0x6c6e616d;
var SEL_MANUFACTURER = 0x6c6d616b;
var SEL_STREAM = 0x736c6179;
var SEL_RATES = 0x6e737223;
var SCOPE_GLOBAL = 0x676c6f62;
var SCOPE_INPUT = 0x696e7074;
var SCOPE_OUTPUT = 0x6f757470;
var ELEMENT = 0;
var SYSTEM = 1;
var UTF8 = 0x08000100;
var held = [];
var structOk = null;
var bytesChecked = false;

function b64decode(value) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var clean = String(value).replace(/[^A-Za-z0-9+/]/g, "");
  var out = [];
  var buffer = 0;
  var bits = 0;
  var i;
  for (i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | alphabet.indexOf(clean.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
    }
  }
  return out;
}

function dataFromBytes(bytes) {
  var data = $.NSMutableData.data();
  var slot = $.malloc(8);
  var i;
  for (i = 0; i < bytes.length; i++) {
    slot[0] = bytes[i];
    data.appendBytesLength(slot, 1);
  }
  held.push(data);
  return data;
}

function u32bytes(value) {
  value = value >>> 0;
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

function readBytes(ptr, length) {
  var data = $.NSData.dataWithBytesLength(ptr, length);
  return b64decode(ObjC.unwrap(data.base64EncodedStringWithOptions(0)));
}

function assertByteWriter() {
  var data = dataFromBytes([0x23, 0x76, 0x65, 0x64]);
  var bytes = readBytes(data.bytes, 4);
  if (!bytes || bytes.length < 4 || bytes[0] !== 0x23 || bytes[1] !== 0x76 || bytes[2] !== 0x65 || bytes[3] !== 0x64) {
    throw new Error("bytes");
  }
}

function structWorks() {
  if (structOk !== null) return structOk;
  try {
    var address = Ref();
    address[0] = { mSelector: SEL_DEVICES, mScope: SCOPE_GLOBAL, mElement: ELEMENT };
    var size = Ref();
    size[0] = 0;
    var err = $.AudioObjectGetPropertyDataSize(SYSTEM, address, 0, null, size);
    structOk = err === 0;
  } catch (err) {
    structOk = false;
  }
  return structOk;
}

function callProperty(deviceId, selector, scope, element, fn) {
  if (structWorks()) {
    var address = Ref();
    address[0] = { mSelector: selector >>> 0, mScope: scope >>> 0, mElement: element >>> 0 };
    return fn(address);
  }
  if (!bytesChecked) {
    assertByteWriter();
    bytesChecked = true;
  }
  var data = dataFromBytes(u32bytes(selector).concat(u32bytes(scope), u32bytes(element)));
  return fn(data.bytes);
}

function utf8FromBytes(bytes) {
  var end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  var binary = "";
  var i;
  for (i = 0; i < end; i++) binary += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(binary));
  } catch (err) {
    return null;
  }
}

function asJsString(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  try {
    var unwrapped = ObjC.unwrap(value);
    if (typeof unwrapped === "string") return unwrapped;
  } catch (err) {}
  try {
    if (typeof value.js === "string") return value.js;
  } catch (err2) {}
  try {
    if (value.UTF8String !== null && value.UTF8String !== undefined) {
      var utf = ObjC.unwrap(value.UTF8String);
      if (typeof utf === "string") return utf;
    }
  } catch (err3) {}
  try {
    var buf = $.malloc(4096);
    if (!$.CFStringGetCString(value, buf, 4096, UTF8)) return null;
    return utf8FromBytes(readBytes(buf, 4096));
  } catch (err4) {
    return null;
  }
}

function readString(deviceId, selector) {
  return callProperty(deviceId, selector, SCOPE_GLOBAL, ELEMENT, function (address) {
    var size = Ref();
    size[0] = 8;
    var out = Ref();
    var err = $.AudioObjectGetPropertyData(deviceId, address, 0, null, size, out);
    if (err !== 0) return null;
    var value = out[0];
    var text = asJsString(value);
    if (typeof text === "string") text = String(text);
    try {
      if (value && typeof value !== "number") $.CFRelease(value);
    } catch (releaseErr) {}
    if (typeof text !== "string") throw new Error("cfstring");
    return text;
  });
}

function propertySize(deviceId, selector, scope) {
  return callProperty(deviceId, selector, scope, ELEMENT, function (address) {
    var size = Ref();
    size[0] = 0;
    var err = $.AudioObjectGetPropertyDataSize(deviceId, address, 0, null, size);
    if (err !== 0) return 0;
    return size[0] || 0;
  });
}

function probed(deviceId) {
  if (propertySize(deviceId, SEL_STREAM, SCOPE_OUTPUT) <= 0) return false;
  if (propertySize(deviceId, SEL_STREAM, SCOPE_INPUT) <= 0) return false;
  if (propertySize(deviceId, SEL_RATES, SCOPE_OUTPUT) <= 0 && propertySize(deviceId, SEL_RATES, SCOPE_INPUT) <= 0) return false;
  return true;
}

function deviceIds() {
  return callProperty(SYSTEM, SEL_DEVICES, SCOPE_GLOBAL, ELEMENT, function (address) {
    var size = Ref();
    size[0] = 0;
    var err = $.AudioObjectGetPropertyDataSize(SYSTEM, address, 0, null, size);
    if (err !== 0) throw new Error("devices");
    var byteCount = size[0] || 0;
    if (byteCount < 4) return [];
    var buf = $.malloc(byteCount);
    var io = Ref();
    io[0] = byteCount;
    err = $.AudioObjectGetPropertyData(SYSTEM, address, 0, null, io, buf);
    if (err !== 0) throw new Error("devices");
    var actual = io[0] || byteCount;
    if (actual > byteCount || actual < 4) actual = byteCount;
    var bytes = readBytes(buf, actual);
    var ids = [];
    var i;
    for (i = 0; i + 3 < bytes.length; i += 4) {
      ids.push((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0);
    }
    return ids;
  });
}

function list() {
  var ids = deviceIds();
  var devices = [];
  var i;
  for (i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (!id || !probed(id)) continue;
    var manufacturer = readString(id, SEL_MANUFACTURER);
    var name = readString(id, SEL_NAME);
    if (manufacturer === null || name === null) continue;
    devices.push({ id: id, manufacturer: manufacturer, name: name });
  }
  return JSON.stringify({ devices: devices });
}

list();
`;

let cachedNames = null;

function coreAudioDeviceLabel(manufacturer, name) {
  if (typeof name !== "string" || name.length === 0) return "";
  const maker = typeof manufacturer === "string" ? manufacturer : "";
  return `${maker}: ${name}`;
}

function utf8NamesByDeviceId(entries) {
  const map = Object.create(null);
  if (!Array.isArray(entries)) return map;
  const used = new Set();
  entries.forEach((entry, index) => {
    const label = coreAudioDeviceLabel(entry && entry.manufacturer, entry && entry.name);
    const rtId = RTAUDIO_FIRST_DEVICE_ID + index;
    if (!label) return;
    map[rtId] = label;
    used.add(rtId);
  });
  entries.forEach((entry) => {
    if (!entry || entry.id == null || entry.id === "") return;
    const audioId = Number(entry.id);
    if (!Number.isFinite(audioId) || used.has(audioId) || Object.prototype.hasOwnProperty.call(map, audioId)) return;
    const label = coreAudioDeviceLabel(entry.manufacturer, entry.name);
    if (!label) return;
    map[audioId] = label;
  });
  return map;
}

function applyUtf8DeviceNames(devices, namesById) {
  if (!Array.isArray(devices) || !namesById) return devices;
  let changed = false;
  const next = devices.map((device) => {
    if (!device || device.deviceId == null) return device;
    const utf8 = namesById[device.deviceId];
    if (typeof utf8 !== "string" || utf8.length === 0 || utf8 === device.name) return device;
    changed = true;
    return { ...device, name: utf8 };
  });
  return changed ? next : devices;
}

function namesIfDeviceCountMatches(entries, audifyDeviceCount) {
  if (!Array.isArray(entries) || entries.length !== audifyDeviceCount) return null;
  return utf8NamesByDeviceId(entries);
}

function listedDeviceNames(devices, platform, namesById) {
  if (platform !== "darwin") return devices;
  return applyUtf8DeviceNames(devices, namesById);
}

function devicesFromOsascript(stdout) {
  const text = String(stdout || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("coreaudio");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!parsed || !Array.isArray(parsed.devices)) throw new Error("coreaudio");
  return parsed.devices;
}

function readCoreAudioDevices() {
  const file = path.join(os.tmpdir(), `live-interpret-audio-names-${process.pid}.js`);
  fs.writeFileSync(file, COREAUDIO_SCRIPT, "utf8");
  try {
    const result = spawnSync("/usr/bin/osascript", ["-l", "JavaScript", file], {
      encoding: "utf8",
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    if (!result || result.error || result.status !== 0) {
      throw new Error((result && (result.stderr || result.error)) || "osascript");
    }
    return devicesFromOsascript(result.stdout);
  } finally {
    try {
      fs.unlinkSync(file);
    } catch (_) {
      /* temp script is only an input to osascript */
    }
  }
}

function macUtf8NamesById() {
  if (cachedNames) return cachedNames;
  try {
    const entries = readCoreAudioDevices();
    cachedNames = { count: entries.length, names: utf8NamesByDeviceId(entries) };
  } catch (_) {
    cachedNames = { count: -1, names: Object.create(null) };
  }
  return cachedNames;
}

module.exports = {
  RTAUDIO_FIRST_DEVICE_ID,
  coreAudioDeviceLabel,
  utf8NamesByDeviceId,
  applyUtf8DeviceNames,
  namesIfDeviceCountMatches,
  listedDeviceNames,
  devicesFromOsascript,
  macUtf8NamesById,
};
