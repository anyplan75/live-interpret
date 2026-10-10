const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAC_AUDIO_NAME_NOTE,
  PROFILER_TIMEOUT_MS,
  labelsFromProfilerReport,
  macInputNameResult,
  resetMacAudioNameCache,
} = require("../broadcast/lib/mac-device-names");

const garbledMic = {
  deviceId: 129,
  name: "Apple Inc.: MacBook Pro ◆◆◆◆ū",
  inputChannels: 1,
};
const garbledPhone = {
  deviceId: 130,
  name: "Apple Inc.: ◆◆JUN◆◆s IPHONE◆◆◆◆◆◆ū",
  inputChannels: 1,
};

function profilerReport(items) {
  return {
    SPAudioDataType: [
      {
        _name: "coreaudio_device",
        _items: items,
      },
    ],
  };
}

const micItem = {
  _name: "MacBook Pro 마이크",
  coreaudio_device_manufacturer: "Apple Inc.",
  coreaudio_device_input: 1,
  coreaudio_device_transport: "coreaudio_device_type_builtin",
};

function spawnReport(report, status = 0) {
  const calls = [];
  function spawn(command, args, options) {
    calls.push({ command, args, options });
    return {
      status,
      stdout: typeof report === "string" ? report : JSON.stringify(report),
      stderr: "",
    };
  }
  spawn.calls = calls;
  return spawn;
}

describe("mac device names", { concurrency: false }, () => {
  test("a profiler item replaces the garbled MacBook Pro name", () => {
    resetMacAudioNameCache();
    const report = profilerReport([
      micItem,
      {
        _name: "BlackHole 2ch",
        coreaudio_device_manufacturer: "Existential Audio Inc.",
        coreaudio_device_input: 2,
      },
    ]);
    const labels = labelsFromProfilerReport(report);
    assert.deepEqual(labels, ["Apple Inc.: MacBook Pro 마이크", "Existential Audio Inc.: BlackHole 2ch"]);
    const spawn = spawnReport(report);
    const named = macInputNameResult([garbledMic, garbledPhone], "darwin", spawn);
    assert.equal(named.devices[0].name, "Apple Inc.: MacBook Pro 마이크");
    assert.equal(named.devices[0].deviceId, 129);
    assert.equal(named.devices[0].inputChannels, 1);
    assert.equal(named.note, null);
    assert.equal(spawn.calls[0].command, "/usr/sbin/system_profiler");
    assert.deepEqual(spawn.calls[0].args, ["SPAudioDataType", "-json"]);
    assert.equal(spawn.calls[0].options.timeout, PROFILER_TIMEOUT_MS);
    assert.equal(spawn.calls[0].options.encoding, "utf8");
  });

  test("an output-only speaker does not block the microphone", () => {
    resetMacAudioNameCache();
    const devices = [garbledMic];
    const spawn = spawnReport(profilerReport([
      micItem,
      {
        _name: "MacBook Pro 스피커",
        coreaudio_device_manufacturer: "Apple Inc.",
        coreaudio_device_output: 2,
      },
    ]));
    const named = macInputNameResult(devices, "darwin", spawn);
    assert.equal(named.devices[0].name, "Apple Inc.: MacBook Pro 마이크");
    assert.equal(named.devices[0].inputChannels, 1);
    assert.equal(named.note, null);
  });

  test("two input items with the same ASCII letters stay garbled", () => {
    resetMacAudioNameCache();
    const devices = [garbledMic];
    const spawn = spawnReport(profilerReport([
      micItem,
      {
        _name: "MacBook Pro 입력",
        coreaudio_device_manufacturer: "Apple Inc.",
        coreaudio_device_input: 1,
      },
    ]));
    const named = macInputNameResult(devices, "darwin", spawn);
    assert.equal(named.devices, devices);
    assert.equal(named.devices[0].name, garbledMic.name);
    assert.equal(named.note, null);
  });

  test("profiler failure leaves the original names", () => {
    resetMacAudioNameCache();
    const devices = [garbledMic, garbledPhone];
    function failSpawn() {
      return { status: 1, stdout: "", stderr: "fail", error: new Error("fail") };
    }
    const failed = macInputNameResult(devices, "darwin", failSpawn);
    assert.equal(failed.devices, devices);
    assert.equal(failed.devices[0].name, garbledMic.name);
    assert.equal(failed.devices[1].name, garbledPhone.name);
    assert.equal(failed.note, MAC_AUDIO_NAME_NOTE);

    function throwSpawn() {
      throw new Error("boom");
    }
    const thrown = macInputNameResult(devices, "darwin", throwSpawn);
    assert.equal(thrown.devices[0].name, garbledMic.name);
    assert.equal(thrown.note, MAC_AUDIO_NAME_NOTE);

    const broken = macInputNameResult(devices, "darwin", () => ({ status: 0, stdout: "not-json" }));
    assert.equal(broken.devices[0].name, garbledMic.name);
    assert.equal(broken.note, MAC_AUDIO_NAME_NOTE);
  });

  test("linux and windows do not spawn system_profiler", () => {
    resetMacAudioNameCache();
    const devices = [garbledMic, garbledPhone];
    let calls = 0;
    function spy() {
      calls += 1;
      return { status: 0, stdout: JSON.stringify(profilerReport([micItem])) };
    }
    const linux = macInputNameResult(devices, "linux", spy);
    const win = macInputNameResult(devices, "win32", spy);
    assert.equal(calls, 0);
    assert.equal(linux.devices, devices);
    assert.equal(win.devices, devices);
    assert.equal(linux.note, null);
    assert.equal(win.note, null);
    assert.equal(devices[0].name, garbledMic.name);
    assert.equal(devices[1].name, garbledPhone.name);
  });

  test("a successful profiler read is cached", () => {
    resetMacAudioNameCache();
    const spawn = spawnReport(profilerReport([micItem]));
    const first = macInputNameResult([garbledMic], "darwin", spawn);
    const second = macInputNameResult([garbledMic], "darwin", spawn);
    assert.equal(first.devices[0].name, "Apple Inc.: MacBook Pro 마이크");
    assert.equal(second.devices[0].name, "Apple Inc.: MacBook Pro 마이크");
    assert.equal(spawn.calls.length, 1);

    resetMacAudioNameCache();
    let calls = 0;
    function flaky(command, args, options) {
      calls += 1;
      if (calls === 1) return { status: 1, stdout: "", error: new Error("fail") };
      return spawnReport(profilerReport([micItem]))(command, args, options);
    }
    const failed = macInputNameResult([garbledMic], "darwin", flaky);
    const recovered = macInputNameResult([garbledMic], "darwin", flaky);
    assert.equal(failed.devices[0].name, garbledMic.name);
    assert.equal(failed.note, MAC_AUDIO_NAME_NOTE);
    assert.equal(recovered.devices[0].name, "Apple Inc.: MacBook Pro 마이크");
    assert.equal(calls, 2);
  });
});
