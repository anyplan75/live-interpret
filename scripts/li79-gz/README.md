# LI-79 large-file sidecars

Five sources exceed GitHub MCP single-call embed size. They ship here as gzip+base64.

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
