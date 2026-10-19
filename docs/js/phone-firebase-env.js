// 강연·회의 페이지와 대면 통역 페이지가 로그인할 때 쓰는 파이어베이스 웹 키입니다.
// 데스크톱 앱의 비밀 파일에 있는 FIREBASE_API_KEY 와 같은 값입니다.
// 이 컴퓨터에서 시험 서버가 이미 키를 넣었으면 그 값을 그대로 둡니다.
globalThis.LI_ENV = globalThis.LI_ENV || {};
if (!globalThis.LI_ENV.FIREBASE_API_KEY) {
  globalThis.LI_ENV.FIREBASE_API_KEY = "AIzaSyDsYIaoKxRjNUUOnQvwyYLpPRvNy0WLRUM";
}
