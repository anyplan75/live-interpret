function cleanDisplayName(value) {
  const text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).slice(0, 40).join("");
}

function cleanPhoneId(value) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(text)) return "";
  return text;
}

module.exports = { cleanDisplayName, cleanPhoneId };
