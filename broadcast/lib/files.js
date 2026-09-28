const fs = require("fs");
const { sessionDir, langFile, sessionFolderName } = require("./paths");

function createSessionWriter(root, churchName, when = new Date()) {
  const folderName = sessionFolderName(when);
  const dir = sessionDir(root, churchName, folderName);
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    folderName,
    write(lang, text) {
      const file = langFile(dir, lang);
      const body = String(text || "");
      fs.writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`, "utf8");
      return file;
    },
  };
}

module.exports = { createSessionWriter };
