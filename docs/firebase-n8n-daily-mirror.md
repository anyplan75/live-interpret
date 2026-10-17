# Firebase와 n8n을 매일 복제하기

이 문서는 두 가지를 하루 한 번 남기는 절차입니다.

1. 이 앱의 Firebase 중요 기록을 개인 보관 폴더의 복제 파일로 남깁니다. 그 폴더는 공개 저장소 밖에 두어, 따로 만든 비공개 저장소에 올릴 수 있습니다.
2. n8n에 만들어 둔 워크플로 설계를 매일 비공개 GitHub 저장소에 커밋합니다.

토큰, 비밀번호, OpenAI 키는 이 문서와 이 저장소에 적지 않습니다. 자격 증명은 환경 변수나, 본인이 n8n에서 만든 자격 증명 화면에만 둡니다. 아래의 `< >` 자리는 본인 값으로 바꿉니다. 이 문서는 그 주소를 지어내지 않습니다.

## 공통으로 지킬 것

- 복제 결과는 `live-interpret` 공개 저장소에 커밋하지 않습니다.
- 원격 주소에 토큰을 붙이지 않습니다. `https://<토큰>@github.com/...` 형태를 쓰지 않습니다.
- `cheil`, `jifc` 경로는 읽지 않습니다. 이 앱의 데이터는 `live-interpret` 아래만 있습니다.
- 값을 채운 n8n 워크플로를 다시 내보내 이 저장소에 넣지 않습니다. 노드 칸에 붙인 토큰이 파일에 따라옵니다.

## 1. Firebase 중요 기록

### 이 앱이 실제로 쓰는 곳

프로젝트는 `live-interpret-db65e` 입니다. Realtime Database 주소는 `https://live-interpret-db65e-default-rtdb.asia-southeast1.firebasedatabase.app` 이고, 루트는 `live-interpret` 입니다. 주소와 루트는 `docs/js/catalog.js` 의 `firebase` 에 있습니다. 읽고 쓰는 코드는 `broadcast/lib/firebase.js`, `docs/js/admin.js`, `broadcast/lib/engine.js`, `functions/ledger.js` 입니다.

매일 복제하는 상대 경로는 다음 다섯 개입니다. 전체 경로는 앞에 `live-interpret/` 를 붙인 것입니다.

| 상대 경로 | 남는 내용 |
| --- | --- |
| `admin/uid` | 전체 관리자 uid |
| `accounts` | 로그인 uid 와 그 uid 의 `churchId` |
| `churchIndex` | 교회 이름, 활성화, 지역, 만든 시각 |
| `deposits` | 입금 표시. 교회, 금액, 시각 |
| `churches` | 교회 본문. 아래 표를 포함합니다 |

`churches/<교회아이디>` 안에서 함께 복제되는 기록:

| 경로 | 내용 |
| --- | --- |
| `name`, `active`, `createdAt`, `region` | 교회 이름, 활성화, 만든 시각, 지역 |
| `glossary`, `model` | 예배 용어집, 번역 모델 |
| `account` | 그 교회 로그인의 uid 와 이메일 |
| `preachers` | 설교자 이름, 말투, 교정, 용어, 말 끊는 위치 |
| `sessionIndex` | 방송 폴더의 시작·종료 시각 |
| `sessions/<폴더>/bulletin` | 주보에서 뽑은 글 |
| `sessions/<폴더>/texts` | 언어별 방송 텍스트 |
| `sessions/<폴더>/sentences` | 언어별 문장 |
| `sessions/<폴더>/usage` | 그 방송의 사용량 |
| `billing` | 잔액, 장부, 선불 시간 |
| `live/settings` | 자막 위치, 글자 크기, 색, 언어 |
| `live/usage` | 지금 방송의 사용량 |

### 복제에서 빼는 것

| 경로 | 이유 |
| --- | --- |
| `platform/openaiKey` | OpenAI 키입니다. 읽지 않고, 파일에 남기지도 않습니다. |
| `phoneLinks` | 휴대폰 마이크의 일시적인 연결 정보입니다. 방송 기록이 아닙니다. |
| `churches/*/live/subtitles` | 지금 화면에 나간 자막입니다. 방송이 끝나면 비워지는 값이라 설교 원문으로 보관하지 않습니다. 원문은 `sessions/.../texts` 와 `sentences` 에 있습니다. |

교회 계정 안의 `password`, `refresh_token`, `id_token`, `apiKey` 같은 이름도 복제 파일에서 지웁니다. 이메일과 설교 텍스트는 남습니다.

### 복제 파일

보관 폴더의 기본 위치는 홈 아래 `Documents/live-interpret-private-archive` 입니다. 이 맥에서는 `/Users/anyplan/Documents/live-interpret-private-archive` 입니다.

하루가 지나면 같은 내용의 파일 두 개가 생깁니다.

- `firebase/YYYY-MM-DD.json` — 서울 날짜의 복제본
- `firebase/latest.json` — 가장 최근 복제본

파일 모양은 다음과 같습니다.

```json
{
  "exportedAt": "2026-10-17T18:10:00.000Z",
  "calendarDate": "2026-10-17",
  "timezone": "Asia/Seoul",
  "source": {
    "databaseURL": "https://live-interpret-db65e-default-rtdb.asia-southeast1.firebasedatabase.app",
    "rootPath": "live-interpret"
  },
  "omitted": [
    "platform/openaiKey",
    "phoneLinks",
    "churches/*/live/subtitles"
  ],
  "records": {
    "admin/uid": "",
    "accounts": {},
    "churchIndex": {},
    "deposits": {},
    "churches": {}
  }
}
```

날짜는 서울 자정을 기준으로 바뀝니다. 파일 권한은 소유자만 읽게 둡니다.

### 환경 변수

스크립트는 자격 증명을 환경 변수에서만 읽습니다. 코드, 문서, 복제 파일에는 넣지 않습니다.

| 변수 | 필요할 때 | 값 |
| --- | --- | --- |
| `LIVE_INTERPRET_FIREBASE_REFRESH_TOKEN` | 매일 자동 실행 | 로그인 세션의 갱신 토큰 |
| `FIREBASE_API_KEY` | 위 토큰과 함께 | 이 저장소 `.env.example` 과 같은 이름. 웹 API 키는 `.env` 에만 있습니다 |
| `LIVE_INTERPRET_FIREBASE_ID_TOKEN` | 한 번만 받을 때 | 짧은 ID 토큰. 갱신 토큰이 있으면 이쪽은 쓰지 않습니다 |
| `LIVE_INTERPRET_FIREBASE_DATABASE_URL` | 주소를 바꿀 때만 | 비우면 위의 데이터베이스 주소 |
| `LIVE_INTERPRET_ARCHIVE_DIR` | 폴더를 바꿀 때만 | 비우면 `~/Documents/live-interpret-private-archive` |

스크립트는 방송 앱과 같이 `broadcast/lib/load-env.js` 로 프로젝트 루트의 `.env` 를 환경 변수에 올립니다. 이미 셸에 있는 값은 파일로 덮지 않습니다. `.env` 는 git에서 빠집니다. 그 파일을 커밋하지 않습니다.

갱신 토큰은 방송 앱이 사용자 데이터 폴더의 `admin-session.json` 에 둡니다. 파일 이름은 `broadcast/lib/secrets.js` 의 `SESSION_NAME` 입니다. 그 파일의 `refreshToken` 만 `.env` 의 `LIVE_INTERPRET_FIREBASE_REFRESH_TOKEN` 으로 옮기고, 세션 파일은 저장소에 복사하지 않습니다. 웹 API 키는 `docs/js/catalog.js` 에 없습니다. `.env` 의 `FIREBASE_API_KEY` 만 씁니다.

웹 API 키와 갱신 토큰은 둘 다 있어야 합니다. 스크립트가 `https://securetoken.googleapis.com/v1/token` 에 폼으로 갱신하고, 응답의 ID 토큰으로만 데이터베이스를 읽습니다. ID 토큰, 갱신 토큰, 웹 API 키는 복제 파일에 들어가지 않습니다. 들어갔으면 스크립트가 파일을 쓰지 않고 멈춥니다. `DEPOSIT_HMAC_SECRET` 은 읽지 않습니다.

저장소 안을 보관 폴더로 지정하면 스크립트가 거부합니다. 설교 텍스트와 이메일이 공개 저장소로 가는 것을 막기 위해서입니다.

### 스크립트로 한 번 실행

저장소 루트에서 실행합니다.

```bash
npm run mirror:firebase
```

프로젝트 루트의 `.env` 에 `FIREBASE_API_KEY` 와 `LIVE_INTERPRET_FIREBASE_REFRESH_TOKEN` 이 있으면 그 값이 쓰입니다. 셸에 같은 이름을 미리 넣어 두면 파일보다 셸이 우선합니다.

성공하면 날짜 파일 경로, `latest.json` 경로, 서울 날짜만 출력합니다. 설교 본문과 토큰은 출력하지 않습니다.

구현은 `scripts/export-firebase-mirror.js` 입니다. `npm run mirror:firebase` 가 그 파일을 실행합니다.

### 개인 보관 폴더를 비공개 저장소로

1. 보관 폴더로 이동합니다. 이 저장소 안이 아니어야 합니다.
2. 그 폴더에서 `git init` 을 합니다. `live-interpret` 저장소의 원격을 추가하지 않습니다.
3. GitHub에서 새 저장소를 만들고 공개 범위를 Private 로 둡니다. 이 문서에는 저장소 이름을 정하지 않습니다.
4. 원격을 SSH로 추가합니다. `git@github.com:<본인-계정>/<비공개-저장소>.git`
5. `firebase/YYYY-MM-DD.json` 과 `firebase/latest.json` 을 커밋하고 푸시합니다. 강제 푸시는 하지 않습니다.
6. 다음 날 같은 폴더에서 새 날짜 파일만 추가해 다시 푸시합니다.

### 매일 실행

토큰을 이 저장소나 crontab 줄에 적지 않습니다. 저장소 밖의 환경 파일에만 둡니다.

1. 프로젝트 루트의 git에서 빠진 `.env` 에 빈 이름만 추가하고, 본인 값만 채웁니다. `.env.example` 과 같은 이름입니다. 예제 파일을 커밋된 상태 그대로 두고, `.env` 는 커밋하지 않습니다.

```bash
FIREBASE_API_KEY=
LIVE_INTERPRET_FIREBASE_REFRESH_TOKEN=
LIVE_INTERPRET_ARCHIVE_DIR=
```

2. 서울 03:10에 한 번 실행되게 등록합니다. 경로는 이 저장소를 받아 둔 폴더입니다. 토큰을 crontab 줄에 적지 않습니다. 스크립트가 그 폴더의 `.env` 를 읽습니다.

```cron
CRON_TZ=Asia/Seoul
10 3 * * * cd <이-저장소-경로> && /usr/bin/npm run mirror:firebase
```

n8n으로 같은 일을 하려면 아래 워크플로를 가져옵니다. 스크립트와 워크플로는 같은 다섯 경로를 읽고, 같은 폴더에 같은 모양의 파일을 씁니다.

### n8n으로 같은 복제

가져올 파일은 `n8n/firebase-daily-mirror.json` 입니다. 워크플로는 꺼진 상태로 들어 있고, 자격 증명 칸은 비어 있습니다.

노드 순서는 다음과 같습니다.

1. `매일 03:10` — 서울 시간 매일 03:10. 워크플로 시간대는 `Asia/Seoul` 입니다.
2. `토큰 갱신` — `POST https://securetoken.googleapis.com/v1/token`. `key` 와 `refresh_token` 은 빈 칸입니다. 자격 증명도 비어 있습니다.
3. `보관 폴더` — `/Users/anyplan/Documents/live-interpret-private-archive`. 다른 맥이면 이 값만 바꿉니다.
4. `읽기 admin uid`, `읽기 accounts`, `읽기 churchIndex`, `읽기 deposits`, `읽기 churches` — 위 데이터베이스의 `live-interpret/<경로>.json`. 인증 쿼리는 `토큰 갱신` 이 돌려준 `id_token` 만 씁니다. 토큰 문자열은 파일에 없습니다.
5. `응답 모으기` — 다섯 응답을 한곳으로 모읍니다.
6. `복제 본문` — 스크립트와 같이 키·비밀번호·`live/subtitles` 를 빼고 JSON을 만듭니다.
7. `날짜 파일 저장`, `최신 파일 저장` — `보관 폴더/firebase/YYYY-MM-DD.json` 과 `firebase/latest.json`.

가져오기:

1. n8n 메뉴에서 Import from File 을 고르고 `n8n/firebase-daily-mirror.json` 을 선택합니다.
2. 워크플로 설정에서 시간대가 `Asia/Seoul` 인지 확인합니다.
3. Credentials → New → Custom Auth 를 본인이 만듭니다. 이름은 알아보기 쉬운 것으로 합니다. `key` 에는 `.env` 의 `FIREBASE_API_KEY` 와 같은 값을, `refresh_token` 에는 `LIVE_INTERPRET_FIREBASE_REFRESH_TOKEN` 과 같은 값을 넣습니다. JSON에는 본인 값만 넣습니다.

```json
{
  "headers": {
    "Content-Type": "application/x-www-form-urlencoded"
  },
  "qs": {
    "key": "<본인-웹-API-키>"
  },
  "body": {
    "grant_type": "refresh_token",
    "refresh_token": "<본인-갱신-토큰>"
  }
}
```

4. `토큰 갱신` 노드의 빈 자격 증명 칸에서 방금 만든 자격 증명을 고릅니다. 노드의 `key`, `refresh_token` 칸에는 값을 입력하지 않습니다.
5. 그 노드에서 Send Query 와 Send Body 를 끕니다. 빈 칸이 자격 증명의 값을 덮지 않게 합니다.
6. 보관 폴더를 만듭니다.

```bash
mkdir -p "$HOME/Documents/live-interpret-private-archive/firebase"
chmod 700 "$HOME/Documents/live-interpret-private-archive"
```

7. n8n이 그 폴더를 쓸 수 있는지 확인합니다. Docker 안이면 이 폴더를 컨테이너에 같은 경로로 연결합니다.
8. 워크플로를 저장하고 Active 를 켭니다. 가져오자마자 켜져 있지 않습니다.

토큰 갱신이 400이면 자격 증명의 본문이 폼이 아니라 JSON으로 나간 경우입니다. 그때는 이 워크플로 대신 Execute Command 노드에서 저장소 루트의 `npm run mirror:firebase` 를 실행합니다. n8n 프로세스가 위의 환경 변수를 보게 하면, 스크립트가 같은 파일을 같은 폴더에 씁니다.

다음 날 확인:

1. n8n Executions 에서 이 워크플로가 서울 03:10 이후에 Success 인지 봅니다.
2. 보관 폴더에 `firebase/<내일 서울 날짜>.json` 이 생겼는지 봅니다.
3. `latest.json` 의 `calendarDate` 가 그 날짜인지 봅니다.
4. 파일 안에 `platform/openaiKey` 값이 없고, `live.subtitles` 가 없는지 봅니다. `sessions` 의 텍스트는 있어야 합니다.
5. 그 날짜 파일이 없으면 스케줄이 비어 있거나 n8n이 그 시각에 꺼져 있던 것입니다. 수동으로 Test workflow 를 한 번 실행해 오늘 파일이 생기는지로 경로를 확인할 수 있습니다. 내일 파일은 그 다음 스케줄 성공으로 확인합니다.

## 2. n8n 워크플로를 매일 비공개 GitHub에 남기기

이 흐름은 위의 Firebase 복제와 별개입니다. 매일 본인 n8n의 워크플로를 모두 읽어, 같은 JSON 사본을 비공개 저장소의 날짜 폴더에 커밋합니다. 워크플로를 하루 동안 고치지 않았어도 다음 날 폴더는 새로 생깁니다. 그 폴더가 다음 날의 복제본입니다.

n8n 주소와 API 키, GitHub 토큰은 아래에 없습니다. `<본인-n8n-주소>`, `<본인-n8n-API-키>`, `<본인-계정>`, `<비공개-저장소>`, `<본인-GitHub-토큰>` 만 있습니다.

### 비공개 저장소

1. GitHub에서 New repository 를 엽니다.
2. 저장소 이름은 본인이 정합니다. 이 문서의 자리는 `<비공개-저장소>` 입니다.
3. Visibility 를 Private 로 둡니다.
4. README를 만들어도 되고, 빈 저장소로 두어도 됩니다.
5. Create repository 를 누릅니다.
6. 이 저장소를 `live-interpret` 의 원격으로 추가하지 않습니다.

이후 파일은 `days/<서울날짜>/<워크플로id>.json` 에 쌓입니다. 예: `days/2026-10-18/AbC123.json`.

### 본인이 만드는 자격 증명

n8n API 키:

1. 본인 n8n을 엽니다. 주소는 `https://<본인-n8n-주소>` 입니다. 끝에 슬래시가 있으면 뺍니다.
2. Settings → n8n API 를 엽니다. API가 꺼져 있으면 켭니다.
3. Create an API Key 를 누르고, 용도가 보이게 이름만 적습니다.
4. 한 번 보이는 키를 복사합니다. 이 문서나 채팅에 붙여 넣지 않습니다. 자리는 `<본인-n8n-API-키>` 입니다.

GitHub 토큰:

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Resource owner 는 본인 계정입니다.
3. Repository access 는 Only select repositories 이고, 방금 만든 비공개 저장소만 고릅니다.
4. Permissions → Contents 를 Read and write 로 둡니다. 다른 권한은 주지 않습니다.
5. Generate token 후 한 번만 복사합니다. 자리는 `<본인-GitHub-토큰>` 입니다.

n8n에 자격 증명 두 개를 만듭니다. 값은 자격 증명 화면에만 입력합니다.

1. Credentials → Add credential → Header Auth.
2. 이름: `n8n API`.
3. Name: `X-N8N-API-KEY`
4. Value: `<본인-n8n-API-키>`
5. Save.
6. Header Auth를 하나 더 만듭니다.
7. 이름: `GitHub 비공개 저장소`.
8. Name: `Authorization`
9. Value: `Bearer <본인-GitHub-토큰>`
10. Save.

Header Auth의 Value 앞에 `Bearer ` 와 공백이 있어야 합니다. 토큰만 넣으면 GitHub가 거절합니다.

### 워크플로를 새로 만들기

1. n8n에서 Add workflow.
2. 이름을 `n8n 워크플로 일일 복제` 로 합니다.
3. 오른쪽 위 메뉴 → Settings.
4. Timezone 을 `Asia/Seoul` 로 둡니다.
5. Save executions 는 켜 둡니다. 다음 날 실행 기록으로 스케줄을 확인합니다. 자격 증명 값은 실행 기록에 남지 않는 것이 n8n의 동작입니다. 노드 칸에 토큰을 직접 붙이면 기록과 복제 파일에 남으므로, 토큰은 방금 만든 자격 증명에만 둡니다.

### 1) 스케줄

1. 첫 노드로 Schedule Trigger 를 추가합니다.
2. Trigger Interval 을 Custom (Cron) 으로 둡니다.
3. Expression 에 `20 3 * * *` 를 넣습니다. 서울 03:20 입니다. Firebase 복제(03:10)와 겹치지 않게 10분 뒤입니다.
4. 노드 이름: `매일 03:20`.

이 시각에 n8n 프로세스가 켜져 있어야 합니다. 맥이 잠들어 있으면 그 실행은 빠집니다. 빠졌는지는 다음 날 Executions 에 행이 없는 것으로 확인합니다.

### 2) 워크플로 목록

n8n 공개 API는 `GET https://<본인-n8n-주소>/api/v1/workflows` 입니다. 헤더는 `X-N8N-API-KEY` 입니다. 한 페이지는 최대 250개이고, 응답은 `{ "data": [ ... ], "nextCursor": "..." }` 입니다. `nextCursor` 가 있으면 다음 페이지가 있습니다.

1. HTTP Request 노드를 추가하고 이름을 `목록 1` 로 합니다.
2. Method: GET.
3. URL: `https://<본인-n8n-주소>/api/v1/workflows`
4. Authentication: Generic Credential Type → Header Auth.
5. Credential: `n8n API`.
6. Send Query Parameters 를 켜고 `limit` = `250`.
7. `목록 1` 을 `매일 03:20` 다음에 연결합니다.

페이지가 더 있을 때:

1. IF 노드 `다음 페이지 1`. 조건은 String, 값 `{{ $json.nextCursor }}`, 연산은 is not empty.
2. true 쪽에 HTTP Request `목록 2`.
   - URL은 `목록 1` 과 같습니다.
   - 같은 Header Auth 자격 증명.
   - Query `limit` = `250`, `cursor` = `{{ $('목록 1').item.json.nextCursor }}`.
3. `목록 2` 다음에 IF `다음 페이지 2`. 조건은 `{{ $json.nextCursor }}` is not empty.
4. true 쪽에 HTTP Request `목록 3`. Query `cursor` = `{{ $('목록 2').item.json.nextCursor }}`. 나머지 설정은 `목록 2` 와 같습니다.
5. 750개를 넘으면 `목록 3` 의 `nextCursor` 가 아직 있습니다. 같은 IF와 HTTP 쌍을 한 번 더 잇고, 아래 합치기 코드의 배열에 그 노드 이름을 추가합니다.

### 3) 페이지를 한 목록으로

Code 노드 `합치기` 를 추가하고 Mode 를 Run Once for All Items 로 둡니다. 다음 세 곳에서만 이 노드로 선을 잇습니다.

- `다음 페이지 1` 의 false
- `다음 페이지 2` 의 false
- `목록 3` 의 출력

true 쪽을 `합치기` 에 바로 잇지 않습니다. 다음 목록이 끝나기 전에 합치기가 실행됩니다.

`합치기` 코드:

```javascript
function page(name) {
  try {
    return $(name).first().json;
  } catch (err) {
    return null;
  }
}

const pages = [page("목록 1"), page("목록 2"), page("목록 3")].filter(Boolean);
const rows = [];
for (const body of pages) {
  if (Array.isArray(body.data)) rows.push(...body.data);
}
const last = pages[pages.length - 1];
if (last && last.nextCursor && pages.length >= 3) {
  throw new Error("워크플로가 750개를 넘습니다. 목록 노드를 한 페이지 더 이으세요.");
}
if (!rows.length) return [{ json: { id: "", name: "", empty: true } }];
return rows.map((row) => ({ json: row }));
```

한 페이지만 있으면 `목록 2` 는 실행되지 않고, 코드가 그 노드를 건너뜁니다. 워크플로가 하나도 없으면 `empty: true` 한 건이 나갑니다. 다음 노드에서 그 건은 올리지 않습니다.

### 4) 워크플로를 한 건씩 받기

목록의 각 항목은 요약일 수 있습니다. 노드와 연결이 들어 있는 사본은 한 건 조회로 받습니다.

1. HTTP Request `워크플로 한 건` 을 `합치기` 다음에 연결합니다.
2. Method: GET.
3. URL: `https://<본인-n8n-주소>/api/v1/workflows/{{ $json.id }}`
4. 같은 `n8n API` Header Auth.
5. 이 노드는 항목마다 한 번씩 실행됩니다. 빈 목록이면 URL의 id 가 비어 실패하므로, 앞에 IF 를 하나 두고 `{{ $json.empty }}` is true 이면 멈춥니다. false 만 `워크플로 한 건` 으로 잇습니다.

응답 JSON에는 `id`, `name`, `nodes`, `connections`, `settings`, `active` 가 들어 있습니다. 자격 증명은 `id` 와 `name` 만 있고, 비밀 값은 API가 주지 않습니다. 그래도 노드 매개변수에 예전에 붙여 둔 토큰이 있으면 그 문자열이 JSON에 있습니다. 4단계의 코드가 그런 이름을 가진 값을 비웁니다.

### 5) 날짜 파일 내용

Code 노드 `파일 내용` 을 `워크플로 한 건` 다음에 둡니다. Mode 는 Run Once for Each Item 입니다.

```javascript
const SECRET_KEYS = new Set([
  "password",
  "refreshToken",
  "refresh_token",
  "idToken",
  "id_token",
  "accessToken",
  "access_token",
  "apiKey",
  "api_key",
  "secret",
  "token",
  "openaiKey",
]);

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    out[key] = strip(child);
  }
  return out;
}

const workflow = strip($json);
const id = String(workflow.id || "");
if (!id) return [];
const day = $now.setZone("Asia/Seoul").toFormat("yyyy-MM-dd");
const name = String(workflow.name || id).replace(/[\r\n]/g, " ");
const text = JSON.stringify(workflow, null, 2) + "\n";
return [{
  json: {
    path: `days/${day}/${id}.json`,
    message: `mirror: ${day} ${name}`,
    content: Buffer.from(text, "utf8").toString("base64"),
    branch: "main",
  },
}];
```

이 내용이 그날의 사본입니다. 다음 날은 `days/` 아래 날짜만 바뀌고, 워크플로 JSON은 그 시점의 같은 설계입니다.

### 6) 이미 있는 파일이면 sha 를 붙이기

같은 날 두 번 실행하면 GitHub는 같은 경로가 이미 있다고 거절합니다. 그래서 만들기 전에 파일을 조회합니다.

1. HTTP Request `기존 파일` 을 `파일 내용` 다음에 둡니다.
2. Method: GET.
3. URL: `https://api.github.com/repos/<본인-계정>/<비공개-저장소>/contents/{{ $json.path }}`
4. Authentication: Generic Credential Type → Header Auth → `GitHub 비공개 저장소`.
5. Send Headers 를 켜고 두 줄을 추가합니다.
   - `Accept`: `application/vnd.github+json`
   - `X-GitHub-Api-Version`: `2022-11-28`
   - `User-Agent`: `n8n-workflow-mirror`
6. Options → Response → Include Response Headers and Status 를 켭니다.
7. Never Error 를 켭니다. 없는 파일은 404이고, 404도 다음 노드로 가야 합니다.

Code 노드 `커밋 본문`:

```javascript
const file = $("파일 내용").item.json;
const status = $json.statusCode;
if (status !== 200 && status !== 404) {
  throw new Error(`GitHub 조회 실패: ${status}`);
}
const body = {
  message: file.message,
  content: file.content,
  branch: "main",
};
if (status === 200 && $json.body && $json.body.sha) body.sha = $json.body.sha;
return [{
  json: {
    url: `https://api.github.com/repos/<본인-계정>/<비공개-저장소>/contents/${file.path}`,
    body,
  },
}];
```

`<본인-계정>` 과 `<비공개-저장소>` 는 이 코드 안의 두 자리에 본인 값으로 바꿉니다. 토큰은 이 코드에 넣지 않습니다.

### 7) 커밋

1. HTTP Request `올리기` 를 `커밋 본문` 다음에 둡니다.
2. Method: PUT.
3. URL: `{{ $json.url }}`
4. 같은 `GitHub 비공개 저장소` Header Auth.
5. 헤더 `Accept`, `X-GitHub-Api-Version`, `User-Agent` 는 `기존 파일` 과 같게 넣습니다.
6. Send Body 를 켜고 Body Content Type 을 JSON 으로 둡니다.
7. Specify Body 를 JSON 으로 두고 본문에 `{{ JSON.stringify($json.body) }}` 를 넣습니다.

PUT 본문은 GitHub Contents API 형식입니다. `message`, base64 `content`, `branch` 가 있고, 파일이 이미 있으면 `sha` 가 있습니다. 이 노드가 항목마다 한 번씩 커밋합니다.

### 8) 켜기

1. 워크플로를 저장합니다.
2. 오른쪽 위의 Active 를 켭니다. 끄면 03:20에 실행되지 않습니다.
3. 오늘 확인하려면 Active 와 별도로 Test workflow 또는 Execute workflow 를 한 번 누릅니다. 스케줄을 기다리지 않고 지금 경로가 맞는지 봅니다.

### 다음 날 복제본 확인

오늘 수동 실행으로 경로를 확인한 뒤, 다음 날 서울 03:20이 지난 뒤에 아래를 봅니다.

1. n8n → Executions → `n8n 워크플로 일일 복제`.
2. 시작 시각이 서울 03:20대이고 상태가 Success 인지 봅니다. 행이 없으면 그 시각에 n8n이 꺼져 있었거나 Active 가 아니었습니다.
3. GitHub 비공개 저장소의 커밋 목록에서 메시지가 `mirror: <내일 서울 날짜>` 로 시작하는 커밋을 찾습니다.
4. `days/<내일 서울 날짜>/` 를 엽니다. n8n의 워크플로 수와 JSON 파일 수가 같아야 합니다.
5. 파일 하나를 열어 `nodes` 배열 길이를, n8n에서 그 워크플로를 열었을 때의 노드 수와 비교합니다.
6. 설계를 고치지 않았다면 어제 파일과 내용이 같을 수 있습니다. 날짜 폴더가 새로 생겼으면 그날의 복제본이 맞는 것입니다.
7. 실패한 실행이 있으면 그 날짜 폴더가 비어 있거나 없습니다. 실행 화면의 빨간 노드가 `목록` 이면 API 키 또는 n8n 주소, `기존 파일` 이나 `올리기` 이면 저장소 이름·토큰 권한·Contents 쓰기 권한을 확인합니다. 토큰 값은 실행 화면에 다시 적지 않습니다.

수동으로 다시 돌리면 같은 날짜 폴더의 파일이 `sha` 와 함께 갱신됩니다. 다음 날 폴더와는 경로가 다릅니다.
