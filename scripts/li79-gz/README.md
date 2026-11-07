# LI-79 large-file sidecars

Five sources exceed GitHub MCP single-call embed size. They ship here as gzip+base64
parts that `scripts/expand-li79-gz.js` concatenates in order:

| logical name | parts on disk |
|---|---|
| `docs__js__desk-client.js.b64` | single full file |
| `broadcast__main.js.b64` | `.0` + `.1` |
| `guide.md.b64` | `.0` + `.1` |
| `broadcast__lib__engine.js.b64` | `.0` … `.8` |
| `broadcast__renderer__renderer.js.b64` | `.0` … `.17` |

All five decode+gunzip to the fec02d9 local tree (verified via GitHub Contents API).

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

After expand, optionally drop the upload scaffolding:

```bash
git rm -r --ignore-unmatch .agent-upload scripts/li79-gz scripts/expand-li79-gz.js
# keep or drop in a follow-up commit — Mac content commit above is the important one
```

## Sidecar checksums (sha256 of reassembled .b64 text)

```
docs__js__desk-client.js.b64  7f645f55517f0d1f60bb422a665487cce7b9d7bbbe53a98d93c9b647a2890de9
broadcast__main.js.b64        fe2969ff8d97f08df48176db008964ef3dfe3227d988e2d57b306e0194363028
guide.md.b64                  aa147e0737226d5c206c4ad7bf40a1b6e286bbb9ef85e035e60f5e208a5fec69
broadcast__lib__engine.js.b64 767305e0ed3190b8183723ff22837265e9070e9e94d179adef223ecdaba5281f
broadcast__renderer__renderer.js.b64 4cd8a03aca9eb0de6caeed6ce257a77913c266be1334ffbaa95cc79ec00f94d9
```
