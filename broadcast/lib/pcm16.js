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

if (typeof module === "object" && module.exports) {
  module.exports = { downsampleFloatToPcm16, floatSampleToInt16 };
}
