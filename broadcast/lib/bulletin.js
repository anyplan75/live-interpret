const fs = require("fs");
const path = require("path");
const { parseJsonSafe } = require("./translator");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const MAX_BYTES = 8 * 1024 * 1024;

function mimeFor(ext) {
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeBulletin(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const hymnNumbers = asList(data.hymnNumbers || data.hymns);
  const songTitles = asList(data.songTitles || data.songs || data.titles);
  const scripture = String(data.scripture || "").trim();
  const sermonTitle = String(data.sermonTitle || data.title || "").trim();
  const preacherName = String(data.preacherName || data.preacher || "").trim();
  const extractedText = String(data.extractedText || data.text || "").trim();
  return { hymnNumbers, songTitles, scripture, sermonTitle, preacherName, extractedText };
}

function bulletinRecord(imageRef, extracted) {
  const fields = normalizeBulletin(extracted);
  return {
    imageRef: String(imageRef || ""),
    ...fields,
    analyzedAt: Date.now(),
  };
}

function assertImage(sourcePath) {
  const ext = path.extname(sourcePath || "").toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error("주보 사진은 jpg, png, webp, gif 만 올릴 수 있습니다.");
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) throw new Error("주보 파일을 찾지 못했습니다.");
  if (stat.size <= 0) throw new Error("주보 파일이 비어 있습니다.");
  if (stat.size > MAX_BYTES) throw new Error("주보 사진은 8MB 이하만 올릴 수 있습니다.");
  return ext === ".jpeg" ? ".jpg" : ext;
}

function stageBulletin(dir, sourcePath) {
  const ext = assertImage(sourcePath);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `bulletin${ext}`;
  const absolutePath = path.join(dir, fileName);
  fs.copyFileSync(sourcePath, absolutePath);
  const extractedPath = path.join(dir, "bulletin.json");
  if (fs.existsSync(extractedPath)) fs.rmSync(extractedPath, { force: true });
  return { absolutePath, fileName, imageRef: fileName, dir };
}

function persistBulletinImage(destDir, sourcePath) {
  return stageBulletin(destDir, sourcePath);
}

function readStagedExtraction(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "bulletin.json"), "utf8"));
    const imageName = typeof raw.imageRef === "string" ? raw.imageRef : "";
    if (!imageName || !fs.existsSync(path.join(dir, imageName))) return null;
    return normalizeBulletin(raw);
  } catch (_) {
    return null;
  }
}

function writeExtractionFile(dir, imageRef, extracted) {
  const record = bulletinRecord(imageRef, extracted);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bulletin.json"), JSON.stringify(record, null, 2));
  return record;
}

async function analyzeBulletinImage(opts) {
  const imagePath = opts.imagePath;
  const apiKey = opts.apiKey;
  if (!apiKey) throw new Error("이 컴퓨터에 번역 키가 없습니다. 교회 계정은 관리 페이지의 OpenAI 키를 읽지 못합니다.");
  const ext = assertImage(imagePath);
  const bytes = fs.readFileSync(imagePath);
  const mime = mimeFor(ext);
  const fetchImpl = opts.fetchImpl || fetch;
  const model = opts.model || "gpt-4o-mini";
  const prompt = [
    "한국 교회 예배 주보 사진이다.",
    "찬송·찬양 번호, 곡 제목, 성경 본문, 설교 제목, 설교자 이름을 추출하라.",
    "보이지 않는 항목은 빈 문자열이나 빈 배열로 두어라. 추측으로 채우지 마라.",
    "JSON만 반환하라.",
    '{"hymnNumbers":[""],"songTitles":[""],"scripture":"","sermonTitle":"","preacherName":"","extractedText":""}',
  ].join("\n");
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error((data.error && data.error.message) || `주보 분석 실패 (${response.status})`);
  }
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  return normalizeBulletin(parseJsonSafe(content));
}

module.exports = {
  normalizeBulletin,
  bulletinRecord,
  stageBulletin,
  persistBulletinImage,
  readStagedExtraction,
  writeExtractionFile,
  analyzeBulletinImage,
  MAX_BYTES,
};
