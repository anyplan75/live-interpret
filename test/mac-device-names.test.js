const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RTAUDIO_FIRST_DEVICE_ID,
  utf8NamesByDeviceId,
  rtAudioProbeKeeps,
  listedDeviceNames,
  devicesFromOsascript,
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

test("a garbled Mac name is replaced when a UTF-8 name exists for that id", () => {
  const names = {
    129: "Apple Inc.: MacBook Pro 마이크",
  };
  const listed = listedDeviceNames([garbledMic, garbledPhone], "darwin", names);
  assert.equal(listed[0].name, "Apple Inc.: MacBook Pro 마이크");
  assert.equal(listed[0].deviceId, 129);
  assert.equal(listed[0].inputChannels, 1);
  assert.equal(listed[1].name, garbledPhone.name);
});

test("an unknown id keeps the garbled name", () => {
  const listed = listedDeviceNames([garbledMic], "darwin", {
    999: "Apple Inc.: 다른 마이크",
  });
  assert.equal(listed[0].name, garbledMic.name);
  assert.equal(listedDeviceNames([garbledMic], "darwin", {})[0].name, garbledMic.name);
  assert.equal(listedDeviceNames([garbledMic], "darwin", null)[0].name, garbledMic.name);
});

test("non-darwin list path is unchanged", () => {
  const devices = [garbledMic, garbledPhone];
  const names = {
    129: "Apple Inc.: MacBook Pro 마이크",
    130: "Apple Inc.: 정준의 iPhone 마이크",
  };
  const labels = Object.values(names);
  assert.equal(listedDeviceNames(devices, "linux", names, labels), devices);
  assert.equal(listedDeviceNames(devices, "win32", names, labels), devices);
  assert.equal(devices[0].name, garbledMic.name);
  assert.equal(devices[1].name, garbledPhone.name);
});

test("an input-only mic is kept and numbered from 129", () => {
  const hal = [
    {
      id: 8,
      manufacturer: "Apple Inc.",
      name: "MacBook Pro 마이크",
      inputChannels: 1,
      outputChannels: 0,
      outputConfig: false,
      sampleRates: [48000],
    },
    {
      id: 11,
      manufacturer: "Apple Inc.",
      name: "정준의 iPhone",
      inputChannels: 1,
      outputChannels: 0,
      outputConfig: false,
      sampleRates: [44100],
    },
    {
      id: 4,
      manufacturer: "Apple Inc.",
      name: "MacBook Pro Speakers",
      inputChannels: 0,
      outputChannels: 2,
      inputConfig: false,
      sampleRates: [48000],
    },
    {
      id: 12,
      manufacturer: "Nope",
      name: "Missing streams",
      inputChannels: 1,
      outputChannels: 0,
      outputConfig: false,
      inputConfig: false,
      sampleRates: [48000],
    },
    {
      id: 13,
      manufacturer: "Nope",
      name: "No rates",
      inputChannels: 1,
      outputChannels: 0,
      sampleRates: [],
    },
  ];
  const kept = hal.filter(rtAudioProbeKeeps);
  assert.deepEqual(kept.map((device) => device.name), [
    "MacBook Pro 마이크",
    "정준의 iPhone",
    "MacBook Pro Speakers",
  ]);
  const map = utf8NamesByDeviceId(kept);
  assert.equal(RTAUDIO_FIRST_DEVICE_ID, 129);
  assert.equal(map[129], "Apple Inc.: MacBook Pro 마이크");
  assert.equal(map[130], "Apple Inc.: 정준의 iPhone");
  assert.equal(map[131], "Apple Inc.: MacBook Pro Speakers");
});

test("CoreAudio order is numbered from audify's first device id", () => {
  const map = utf8NamesByDeviceId([
    { id: 42, manufacturer: "Apple Inc.", name: "MacBook Pro 마이크" },
    { id: 77, manufacturer: "Apple Inc.", name: "정준의 iPhone 마이크" },
  ]);
  assert.equal(RTAUDIO_FIRST_DEVICE_ID, 129);
  assert.equal(map[129], "Apple Inc.: MacBook Pro 마이크");
  assert.equal(map[130], "Apple Inc.: 정준의 iPhone 마이크");
  assert.equal(map[42], "Apple Inc.: MacBook Pro 마이크");
  assert.equal(map[77], "Apple Inc.: 정준의 iPhone 마이크");
});

test("an empty CoreAudio name still occupies an RtAudio id", () => {
  const map = utf8NamesByDeviceId([
    { id: 130, manufacturer: "Apple Inc.", name: "" },
    { id: 50, manufacturer: "Apple Inc.", name: "MacBook Pro 마이크" },
  ]);
  assert.equal(map[129], undefined);
  assert.equal(map[130], "Apple Inc.: MacBook Pro 마이크");
  assert.equal(map[50], "Apple Inc.: MacBook Pro 마이크");
});

test("a count mismatch still renames the mic by that letter match", () => {
  const wrongIds = { 129: "BlackHole 2ch" };
  const labels = ["BlackHole 2ch", "Apple Inc.: MacBook Pro 마이크", "Elgato Wave Link"];
  const unknown = { deviceId: 180, name: "Totally Unknown ◆◆◆", inputChannels: 1 };
  const listed = listedDeviceNames([garbledMic, unknown], "darwin", wrongIds, labels);
  assert.equal(listed[0].name, "Apple Inc.: MacBook Pro 마이크");
  assert.equal(listed[0].inputChannels, 1);
  assert.equal(listed[1].name, unknown.name);

  const ambiguous = listedDeviceNames([garbledMic], "darwin", null, [
    "Apple Inc.: MacBook Pro 마이크",
    "Apple Inc.: MacBook Pro 스피커",
  ]);
  assert.equal(ambiguous[0].name, garbledMic.name);
});

test("osascript JSON keeps Korean device names", () => {
  const devices = devicesFromOsascript('{"devices":[{"id":42,"manufacturer":"Apple Inc.","name":"MacBook Pro 마이크"}]}');
  const map = utf8NamesByDeviceId(devices);
  assert.equal(map[129], "Apple Inc.: MacBook Pro 마이크");
});
