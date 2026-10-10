const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RTAUDIO_FIRST_DEVICE_ID,
  utf8NamesByDeviceId,
  namesIfDeviceCountMatches,
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
  assert.equal(listedDeviceNames(devices, "linux", names), devices);
  assert.equal(listedDeviceNames(devices, "win32", names), devices);
  assert.equal(devices[0].name, garbledMic.name);
  assert.equal(devices[1].name, garbledPhone.name);
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

test("a different device count does not assign names", () => {
  const entries = [
    { id: 42, manufacturer: "Apple Inc.", name: "MacBook Pro 마이크" },
  ];
  const devices = [garbledMic];
  assert.equal(namesIfDeviceCountMatches(entries, 2), null);
  assert.equal(listedDeviceNames(devices, "darwin", namesIfDeviceCountMatches(entries, 2)), devices);
  const matched = namesIfDeviceCountMatches(entries, 1);
  assert.equal(listedDeviceNames(devices, "darwin", matched)[0].name, "Apple Inc.: MacBook Pro 마이크");
});

test("osascript JSON keeps Korean device names", () => {
  const devices = devicesFromOsascript('{"devices":[{"id":42,"manufacturer":"Apple Inc.","name":"MacBook Pro 마이크"}]}');
  const map = utf8NamesByDeviceId(devices);
  assert.equal(map[129], "Apple Inc.: MacBook Pro 마이크");
});
