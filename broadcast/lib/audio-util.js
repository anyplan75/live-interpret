/** 인터리브 PCM16에서 채널 하나를 고르고, 인식용 24kHz로 바꿉니다. */

function extractChannel(interleaved, nChannels, channelIndex) {
  const channels = nChannels | 0;
  const index = channelIndex | 0;
  if (channels < 1) throw new Error("채널 수가 없습니다.");
  if (index < 0 || index >= channels) throw new Error("선택한 채널이 장치 범위를 벗어났습니다.");
  const bytes = interleaved.length - (interleaved.length % (channels * 2));
  const frames = bytes / (channels * 2);
  const out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const sample = interleaved.readInt16LE((i * channels + index) * 2);
    out.writeInt16LE(sample, i * 2);
  }
  return out;
}

function channelPeaks(interleaved, nChannels) {
  const channels = nChannels | 0;
  const peaks = new Array(channels).fill(0);
  if (channels < 1) return peaks;
  const bytes = interleaved.length - (interleaved.length % (channels * 2));
  const frames = bytes / (channels * 2);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const amp = Math.abs(interleaved.readInt16LE((i * channels + c) * 2)) / 32768;
      if (amp > peaks[c]) peaks[c] = amp;
    }
  }
  return peaks;
}

function resampleInt16(input, fromRate, toRate) {
  if (!fromRate || !toRate || fromRate === toRate) return Buffer.from(input);
  const inSamples = input.length >> 1;
  if (inSamples < 1) return Buffer.alloc(0);
  const outSamples = Math.max(1, Math.floor((inSamples * toRate) / fromRate));
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const src = (i * fromRate) / toRate;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, inSamples - 1);
    const frac = src - i0;
    const s0 = input.readInt16LE(i0 * 2);
    const s1 = input.readInt16LE(i1 * 2);
    const sample = Math.round(s0 + (s1 - s0) * frac);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }
  return out;
}

function selectedChannelPcm(interleaved, info) {
  const index = info.mode === "single" ? 0 : info.selected;
  return extractChannel(interleaved, info.nChannels, index);
}

function wavFromPcm16(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function rmsInt16(buf) {
  const n = buf.length >> 1;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

module.exports = {
  extractChannel,
  channelPeaks,
  resampleInt16,
  selectedChannelPcm,
  wavFromPcm16,
  rmsInt16,
};
