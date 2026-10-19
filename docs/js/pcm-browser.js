/**
 * 휴대폰 마이크 PCM. 송출 컴퓨터가 받는 형식과 같이 24kHz 16비트입니다.
 */
(function (root) {
  const api = {};

  function floatSampleToInt16(value) {
    const sample = Math.max(-1, Math.min(1, Number(value) || 0));
    return sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }

  function downsampleFloatToPcm16(float32, inputRate, outputRate) {
    const input = float32 || [];
    const inRate = Number(inputRate) || 0;
    const outRate = Number(outputRate) || 0;
    if (!input.length || inRate <= 0 || outRate <= 0) return new Int16Array(0);
    const outLength = inRate === outRate
      ? input.length
      : Math.floor(input.length * outRate / inRate);
    if (outLength <= 0) return new Int16Array(0);
    const out = new Int16Array(outLength);
    if (inRate === outRate) {
      for (let i = 0; i < input.length; i += 1) out[i] = floatSampleToInt16(input[i]);
      return out;
    }
    const ratio = inRate / outRate;
    let offset = 0;
    for (let i = 0; i < outLength; i += 1) {
      const next = Math.min(input.length, Math.max(offset + 1, Math.round((i + 1) * ratio)));
      let sum = 0;
      let count = 0;
      for (let j = offset; j < next; j += 1) {
        sum += input[j];
        count += 1;
      }
      offset = next;
      out[i] = floatSampleToInt16(count ? sum / count : 0);
    }
    return out;
  }

  function mergeInt16(chunks) {
    const list = chunks || [];
    let total = 0;
    list.forEach((chunk) => { total += chunk.length; });
    const out = new Int16Array(total);
    let offset = 0;
    list.forEach((chunk) => {
      out.set(chunk, offset);
      offset += chunk.length;
    });
    return out;
  }

  function rmsInt16(samples) {
    const n = samples ? samples.length : 0;
    if (!n) return 0;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const s = samples[i] / 32768;
      sum += s * s;
    }
    return Math.sqrt(sum / n);
  }

  api.floatSampleToInt16 = floatSampleToInt16;
  api.downsampleFloatToPcm16 = downsampleFloatToPcm16;
  api.mergeInt16 = mergeInt16;
  api.rmsInt16 = rmsInt16;
  root.LI = root.LI || {};
  root.LI.pcm = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
