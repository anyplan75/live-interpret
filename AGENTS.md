# 실시간 통역시스템 (live-interpret) — 에이전트 안내

방송실 PC가 설교 음성을 받아 고른 언어로 교정·번역하고, 성도 자막과 OBS 오버레이로 보내는 앱입니다.
Electron 방송실 앱(`broadcast/`), GitHub Pages 웹(`docs/`), 입금 함수(`functions/`), 아이폰 셸(`ios/`)로 이루어져 있고, 데이터는 Firebase RTDB `live-interpret/` 경로만 씁니다.

## 먼저 읽을 것

- `전체구조안내서.md` — 구조·Firebase 경로·환경 변수·서명 주의사항의 원본. 이 파일과 다르면 안내서가 맞습니다.

## 실행·검사 (Node.js 20+)

```bash
cp .env.example .env     # FIREBASE_API_KEY만 채움, 커밋 금지
npm install
npm test                 # test/*.js — 외부 서비스 없이 돕니다
npm start                # 방송실 앱(소스 실행)
npm run start:settings   # 개발용 설정 창
npm run web              # docs/ 를 http://127.0.0.1:8080 에서 확인
```

설치 파일: `npm run pack:mac` / `dist:mac` / `dist:mas`(Mac), `dist:win`(Windows). `audify`가 네이티브 모듈이라 그 운영체제에서만 만듭니다. 태그 `v*` 푸시는 GitHub Actions 초안 릴리스를 만듭니다.

## 꼭 지킬 것

- `.env`를 스테이징·커밋하지 않습니다. 커밋 전에 `git status`, `git ls-files`로 확인합니다.
- `cheil`, `jifc` 경로를 만들거나 읽지 않습니다.
- 경로를 바꾸면 `docs/js/catalog.js`의 `underRoot`를 통과하게 하고, `firebase/live-interpret.rules.json`을 맞춥니다. 규칙을 기존보다 느슨하게 하지 않습니다.
- `docs/js/runtime-env.js`는 빈 객체만 커밋합니다. 웹 접속 키는 `docs/js/phone-firebase-env.js` 한 곳에만 둡니다.
- 강제 푸시와 태그 이동을 하지 않습니다.
- 보라색 말풍선 아이콘과 Mac App Store 서명 설정(`build/entitlements*.plist`, 프로파일)은 안내서 5장을 읽기 전에는 바꾸지 않습니다.
- 빌드 결과(`dist/`, `build/ios-phone/`, `EXE/`, `android/`)는 커밋하지 않습니다.

## 작업 방식 (Cursor·Devin 공통)

- 이 저장소는 Cursor와 Devin이 번갈아 작업합니다. 둘 다 이 파일 → `전체구조안내서.md` → `작업인계.md` → `작업일지.md` 맨 위 항목 순서로 읽고 시작합니다.
- 시작 전에 `git status`와 현재 브랜치를 확인합니다. 커밋하지 않은 변경은 사용자 작업일 수 있으니 지우거나 덮어쓰지 않습니다.
- 새 작업은 최신 `main`에서 새 브랜치로 합니다. Cursor는 `cursor/<짧은-설명>-<4자리>`, Devin은 `devin/<짧은-설명>`을 씁니다. 끝나면 PR로 `main`에 합칩니다.
- `main`에 강제 푸시하지 않고, 히스토리를 다시 쓰지 않습니다.
- 커밋 메시지는 무엇이 바뀌는지 한 문장으로 씁니다.
- 파일은 필요한 부분만 고칩니다. 파일 전체를 자리표시자나 `…` 생략으로 다시 쓰지 않습니다.
- 비밀 값(키, 비밀번호, 토큰, 서버 주소)은 코드·문서·커밋·로그에 쓰지 않습니다. 이름만 적습니다.
- 구조, 실행 명령, 데이터 경로, 주의사항이 바뀌면 같은 PR에서 `전체구조안내서.md`도 고칩니다. 이 파일(AGENTS.md)에는 요약과 규칙만 둡니다.
- 작업을 마치거나 멈출 때 `작업일지.md` 맨 위에 항목을 하나 추가하고(날짜·작성자 Cursor/Devin·기기·브랜치·한 일·다음 할 일), `작업인계.md`의 진행 중·다음 할 일을 갱신합니다. 두 파일은 커밋해서 GitHub에도 올립니다.
- 기본 작업 기기는 맥미니(`juns-macmini`, Tailscale)입니다. 맥북에서는 Cursor Remote-SSH로 맥미니 폴더를 열고, Devin은 클라우드에서 Tailscale SSH로 맥미니에 접속합니다.

## 실행 파일 (EXE 폴더)
- 만든 설치·실행 파일은 `EXE/<기기>/`에 둡니다. 기기 폴더: `맥`, `윈도우` (아이폰은 TestFlight로 배포)
- 파일 이름: `<앱이름>-<기기>-<버전>[-빌드N][-아키텍처].<확장자>` (예: `실시간통역시스템-윈도우-0.1.59-x64.exe`)
- 예전 버전은 지우지 않고 같이 둡니다. 새 버전을 만들면 버전·빌드 번호를 올려 새 이름으로 넣습니다.
- `EXE/`는 git에 올리지 않습니다(이 Mac의 `.git/info/exclude`와 `.cursorignore`로 제외). Cursor·Devin 모두 소스로 읽거나 고치지 않습니다.
