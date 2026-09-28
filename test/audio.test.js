const test = require("node:test");
const assert = require("node:assert/strict");
const { extractChannel, resampleInt16, selectedChannelPcm, wavFromPcm16, channelPeaks } = require("../broadcast/lib/audio-util");
const { UtteranceVad } = require("../broadcast/lib/vad");
const { listInputDevices } = require("../broadcast/lib/audio");

test("recognition uses only the selected channel", () => {
  const interleaved = Buffer.alloc(8);
  interleaved.writeInt16LE(10, 0);
  interleaved.writeInt16LE(20, 2);
  interleaved.writeInt16LE(30, 4);
  interleaved.writeInt16LE(40, 6);
  const mono = selectedChannelPcm(interleaved, { mode: "all", nChannels: 2, selected: 1 });
  assert.equal(mono.length, 4);
  assert.equal(mono.readInt16LE(0), 20);
  assert.equal(mono.readInt16LE(2), 40);
  assert.deepEqual([...channelPeaks(interleaved, 2)].map((n) => Math.round(n * 32768)), [30, 40]);
  assert.throws(() => extractChannel(interleaved, 2, 2), /범위/);
});

test("resample keeps a single channel at 24 kHz length", () => {
  const input = Buffer.alloc(480 * 2);
  for (let i = 0; i < 480; i++) input.writeInt16LE(1000, i * 2);
  const out = resampleInt16(input, 48000, 24000);
  assert.equal(out.length, 240 * 2);
  assert.equal(resampleInt16(input, 24000, 24000).equals(input), true);
  const wav = wavFromPcm16(out, 24000);
  assert.equal(wav.slice(0, 4).toString(), "RIFF");
  assert.equal(wav.readUInt32LE(24), 24000);
});

test("vad returns one utterance after speech and silence", () => {
  const rate = 1000;
  const vad = new UtteranceVad({ sampleRate: rate, silenceMs: 100, preRollMs: 40, minSpeechMs: 50, threshold: 0.01 });
  const frame = (ms, amp) => {
    const n = Math.round((rate * ms) / 1000);
    const buf = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i) * amp * 32767), i * 2);
    return buf;
  };
  let finished = null;
  vad.push(frame(80, 0));
  vad.push(frame(80, 0.4));
  const end = vad.push(frame(120, 0));
  finished = end.finished ? end : null;
  assert.ok(finished && finished.utterance.length > 0);

  const quiet = new UtteranceVad({ sampleRate: rate, silenceMs: 50, preRollMs: 10, minSpeechMs: 80, threshold: 0.01 });
  quiet.push(frame(30, 0.4));
  const tooShort = quiet.push(frame(80, 0));
  assert.equal(tooShort.finished, false);
});

test("host audio APIs can be queried without throwing", () => {
  const result = listInputDevices();
  assert.ok(Array.isArray(result.devices));
  assert.ok(Array.isArray(result.notes));
  result.devices.forEach((device) => {
    assert.ok(device.inputChannels > 0);
    assert.match(device.apiLabel, /CoreAudio|WASAPI|ASIO|ALSA|PulseAudio/);
  });
});
