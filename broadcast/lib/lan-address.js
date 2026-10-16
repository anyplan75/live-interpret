const os = require("os");

function lanIPv4s() {
  const found = [];
  const nets = os.networkInterfaces();
  Object.entries(nets).forEach(([name, addrs]) => {
    (addrs || []).forEach((addr) => {
      const v4 = addr.family === "IPv4" || addr.family === 4;
      if (!v4 || addr.internal) return;
      found.push({ name, address: addr.address });
    });
  });
  found.sort((a, b) => {
    if (a.name === "en0" && b.name !== "en0") return -1;
    if (b.name === "en0" && a.name !== "en0") return 1;
    return a.address.localeCompare(b.address);
  });
  return {
    primary: found.length ? found[0].address : "",
    all: found.map((item) => item.address),
  };
}

function joinUrl(host, port) {
  const ip = String(host || "").trim();
  const number = Number(port);
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    throw new Error("송출 컴퓨터의 참여 주소에는 Wi-Fi 주소가 필요합니다.");
  }
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error("참여 포트가 올바르지 않습니다.");
  }
  const url = `https://${ip}:${number}/`;
  if (!url.startsWith("https://")) throw new Error("참여 주소는 https 여야 합니다.");
  return url;
}

module.exports = { lanIPv4s, joinUrl };
