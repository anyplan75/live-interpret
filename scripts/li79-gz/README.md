# LI-79 large-file sidecars

Five sources exceed GitHub MCP single-call embed size. They ship here as gzip+base64
(either `NAME.b64` or `NAME.0.b64` + `NAME.1.b64` parts that concatenate).

## Mac apply

```bash
cd ~/Dev/live-interpret   # or your clone
git fetch origin
git checkout -B cursor/fix-pipeline-start-delay-117f origin/cursor/fix-pipeline-start-delay-117f
node scripts/expand-li79-gz.js
git add docs/js/desk-client.js broadcast/lib/engine.js broadcast/main.js \
  broadcast/renderer/renderer.js 전체구조안내서.md
git commit -m '교정 파이프라인·종료 잔존·시작 지연과 함께 시작확인 3초·1시간 시계·시간 과금을 맞춘다'
git push -u origin cursor/fix-pipeline-start-delay-117f
```

Optional equivalent from `.agent-upload/gz`:

```bash
node .agent-upload/gz/expand.js
```

Then remove `.agent-upload` before the final commit if desired:

```bash
git rm -r --ignore-unmatch .agent-upload
git commit --amend --no-edit   # or a separate cleanup commit
```

## Sidecar checksums (sha256 of .b64 text)

```
docs__js__desk-client.js.b64  7f645f55517f0d1f60bb422a665487cce7b9d7bbbe53a98d93c9b647a2890de9
broadcast__main.js.b64        fe2969ff8d97f08df48176db008964ef3dfe3227d988e2d57b306e0194363028
guide.md.b64                  aa147e0737226d5c206c4ad7bf40a1b6e286bbb9ef85e035e60f5e208a5fec69
broadcast__lib__engine.js.b64 767305e0ed3190b8183723ff22837265e9070e9e94d179adef223ecdaba5281f
broadcast__renderer__renderer.js.b64 4cd8a03aca9eb0de6caeed6ce257a77913c266be1334ffbaa95cc79ec00f94d9
```
