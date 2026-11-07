# LI-79 apply

On Mac (`~/Dev/live-interpret`):

```bash
cd ~/Dev/live-interpret
git fetch origin
git checkout -B cursor/fix-pipeline-start-delay-117f origin/cursor/fix-pipeline-start-delay-117f
BASE=.agent-upload/li79
rm -f /tmp/li79-files.b64
for f in $(ls "$BASE"/part-*.txt | sort); do cat "$f" >> /tmp/li79-files.b64; done
base64 -d /tmp/li79-files.b64 > /tmp/li79-files.tgz
tar -xzf /tmp/li79-files.tgz
git add -A
git reset HEAD .agent-upload || true
rm -rf .agent-upload
git add -A
git commit -m '교정 파이프라인·종료 잔존·시작 지연과 함께 시작확인 3초·1시간 시계·시간 과금을 맞춘다'
git push -u origin cursor/fix-pipeline-start-delay-117f
```

Then build:
`MAS_BUILD_VERSION=0.1.63 npm run dist:mas` and `MAC_BUILD_VERSION=0.1.63 npm run dist:mac`, copy to EXE/맥, upload TF to group 내부.
