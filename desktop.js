/**
 * 설치본은 하나의 실행 파일입니다.
 * 그냥 열면 방송실이고, --settings 이면 통역 설정 앱입니다.
 */
if (process.argv.includes("--settings")) require("./settings/main.js");
else require("./broadcast/main.js");
