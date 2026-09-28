const { channelPeaks } = require("./audio-util");

function loadAudify() {
  try {
    return require("audify");
  } catch (err) {
    throw new Error(
      `오디오 라이브러리를 불러오지 못했습니다. 방송 PC에서 npm install 을 다시 실행해 주세요. (${err.message})`
    );
  }
}

function hostApis(RtAudioApi) {
  if (process.platform === "darwin") {
    return [{ id: RtAudioApi.MACOSX_CORE, label: "CoreAudio" }];
  }
  if (process.platform === "win32") {
    return [
      { id: RtAudioApi.WINDOWS_WASAPI, label: "WASAPI" },
      { id: RtAudioApi.WINDOWS_ASIO, label: "ASIO" },
    ];
  }
  return [
    { id: RtAudioApi.LINUX_ALSA, label: "ALSA" },
    { id: RtAudioApi.LINUX_PULSE, label: "PulseAudio" },
  ];
}

function listInputDevices() {
  const { RtAudio, RtAudioApi } = loadAudify();
  const devices = [];
  const notes = [];
  hostApis(RtAudioApi).forEach((api) => {
    let rt;
    try {
      rt = new RtAudio(api.id);
    } catch (err) {
      notes.push(`${api.label}: 이 PC에서 사용할 수 없습니다. ${err.message || ""}`.trim());
      return;
    }
    let found = [];
    try {
      found = rt.getDevices() || [];
    } catch (err) {
      notes.push(`${api.label}: 장치를 읽지 못했습니다. ${err.message || ""}`.trim());
      return;
    }
    const inputs = found.filter((device) => device.inputChannels > 0);
    if (!inputs.length) notes.push(`${api.label}: 입력 장치가 없습니다.`);
    const apiName = (() => {
      try {
        return rt.getApi();
      } catch (_) {
        return api.label;
      }
    })();
    inputs.forEach((device) => {
      devices.push({
        key: `${api.id}:${device.id}`,
        apiId: api.id,
        apiLabel: api.label,
        apiName,
        deviceId: device.id,
        name: device.name,
        inputChannels: device.inputChannels,
        sampleRate: device.preferredSampleRate || (device.sampleRates && device.sampleRates[0]) || 48000,
        sampleRates: device.sampleRates || [],
        isDefault: !!device.isDefaultInput,
      });
    });
  });
  return { devices, notes };
}

function uniqueRates(device) {
  const rates = [device.sampleRate, 48000, 44100, 32000, 16000].filter((rate) => rate > 0);
  return [...new Set(rates)];
}

class InputCapture {
  constructor() {
    this.rt = null;
    this.device = null;
    this.opened = null;
    this.onPcm = null;
    this.onError = null;
  }

  start(device, hooks) {
    this.device = device;
    this.onPcm = hooks.onPcm;
    this.onError = hooks.onError;
    this.opened = this._open(device, {
      mode: "all",
      nChannels: device.inputChannels,
      firstChannel: 0,
    });
    this.opened.selected = 0;
    this.opened.deviceChannel = 0;
    return this.snapshot();
  }

  selectChannel(index) {
    if (!this.device) throw new Error("입력 장치를 먼저 선택해 주세요.");
    if (index < 0 || index >= this.device.inputChannels) throw new Error("채널 범위 밖입니다.");
    if (this.opened && this.opened.mode === "all" && index < this.opened.nChannels) {
      this.opened.selected = index;
      this.opened.deviceChannel = index;
      return this.snapshot();
    }
    this.opened = this._open(this.device, {
      mode: "single",
      nChannels: 1,
      firstChannel: index,
    });
    this.opened.selected = 0;
    this.opened.deviceChannel = index;
    return this.snapshot();
  }

  snapshot() {
    if (!this.opened || !this.device) return null;
    return {
      deviceKey: this.device.key,
      deviceName: this.device.name,
      apiLabel: this.device.apiLabel,
      mode: this.opened.mode,
      openedChannels: this.opened.nChannels,
      deviceChannels: this.device.inputChannels,
      deviceChannel: this.opened.deviceChannel,
      sampleRate: this.opened.sampleRate,
    };
  }

  stop() {
    try {
      if (this.rt && this.rt.isStreamRunning && this.rt.isStreamRunning()) this.rt.stop();
    } catch (_) {
      /* 이미 멈춘 스트림 */
    }
    try {
      if (this.rt && this.rt.isStreamOpen && this.rt.isStreamOpen()) this.rt.closeStream();
    } catch (_) {
      /* 닫기 실패는 다음 오픈에서 다시 시도 */
    }
    this.rt = null;
    this.opened = null;
  }

  _open(device, plan) {
    const { RtAudio, RtAudioFormat } = loadAudify();
    this._closeStreamOnly();
    const rt = new RtAudio(device.apiId);
    this.rt = rt;
    const plans = this._plans(device, plan);
    const rates = uniqueRates(device);
    let lastError = null;
    for (const rate of rates) {
      for (const candidate of plans) {
        try {
          if (rt.isStreamOpen && rt.isStreamOpen()) rt.closeStream();
          const frameSize = device.apiLabel === "ASIO" ? 0 : 480;
          const opened = {
            mode: candidate.mode,
            nChannels: candidate.nChannels,
            firstChannel: candidate.firstChannel,
            sampleRate: rate,
            selected: 0,
            deviceChannel: candidate.firstChannel,
          };
          this.opened = opened;
          rt.openStream(
            null,
            {
              deviceId: device.deviceId,
              nChannels: candidate.nChannels,
              firstChannel: candidate.firstChannel,
            },
            RtAudioFormat.RTAUDIO_SINT16,
            rate,
            frameSize,
            "live-interpret",
            (input) => {
              const copy = Buffer.from(input);
              const info = {
                nChannels: opened.nChannels,
                sampleRate: opened.sampleRate,
                mode: opened.mode,
                selected: opened.selected,
                deviceChannel: opened.deviceChannel,
                deviceChannels: device.inputChannels,
              };
              if (this.onPcm) this.onPcm(copy, info);
            },
            null,
            0,
            (_type, message) => {
              if (this.onError) this.onError(message || "오디오 오류");
            }
          );
          rt.start();
          opened.sampleRate = rt.getStreamSampleRate ? rt.getStreamSampleRate() || rate : rate;
          return opened;
        } catch (err) {
          lastError = err;
        }
      }
    }
    this._closeStreamOnly();
    throw lastError || new Error("입력 장치를 열 수 없습니다.");
  }

  _plans(device, requested) {
    if (requested.mode === "single") return [requested];
    const plans = [{ mode: "all", nChannels: device.inputChannels, firstChannel: 0 }];
    if (device.inputChannels > 2) plans.push({ mode: "all", nChannels: 2, firstChannel: 0 });
    if (device.inputChannels > 1) plans.push({ mode: "single", nChannels: 1, firstChannel: 0 });
    return plans;
  }

  _closeStreamOnly() {
    try {
      if (this.rt && this.rt.isStreamRunning && this.rt.isStreamRunning()) this.rt.stop();
    } catch (_) { /* ignore */ }
    try {
      if (this.rt && this.rt.isStreamOpen && this.rt.isStreamOpen()) this.rt.closeStream();
    } catch (_) { /* ignore */ }
    this.rt = null;
  }
}

module.exports = {
  listInputDevices,
  InputCapture,
  channelPeaks,
};
