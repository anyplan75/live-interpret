#!/usr/bin/env bash
# 아이폰 시험 설치(TestFlight)용으로만 올린다.
# 강연·회의와 대면통역 페이지를 여는 껍데기를 서명해 업로드한다.
# 맥 앱스토어 빌드는 만들지 않는다. 비밀 열쇠는 출력하지 않는다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TEAM_ID="ZJYZ656BL8"
BUNDLE_ID="com.anyplan.liveinterpret.phone"
BUILD_DIR="$ROOT/build/ios-phone"
ARCHIVE_PATH="$BUILD_DIR/LiveInterpret.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"

KEY_DIR="${HOME}/.appstoreconnect/private_keys"
META_FILE="$(find "$KEY_DIR" -maxdepth 1 -name '*.txt' -print -quit)"
if [[ -z "$META_FILE" ]]; then
  echo "App Store Connect 열쇠 폴더에 이름 파일이 없습니다." >&2
  exit 1
fi

# 열쇠 파일에서 아이디만 읽고, 값은 화면에 찍지 않는다.
eval "$(python3 - "$META_FILE" <<'PY'
import shlex, sys
from pathlib import Path
vals = {}
for line in Path(sys.argv[1]).read_text().splitlines():
    if "=" not in line or line.strip().startswith("#"):
        continue
    key, value = line.split("=", 1)
    vals[key.strip()] = value.strip().strip('"').strip("'")
need = ("ASC_KEY_ID", "ASC_ISSUER_ID")
missing = [name for name in need if not vals.get(name)]
if missing:
    sys.stderr.write("열쇠 이름 파일에 필요한 항목이 없습니다.\n")
    sys.exit(1)
print(f"ASC_KEY_ID={shlex.quote(vals['ASC_KEY_ID'])}")
print(f"ASC_ISSUER_ID={shlex.quote(vals['ASC_ISSUER_ID'])}")
PY
)"

KEY_PATH="$KEY_DIR/AuthKey_${ASC_KEY_ID}.p8"
if [[ ! -f "$KEY_PATH" ]]; then
  echo "App Store Connect 비공개 열쇠 파일이 없습니다." >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"
cat > "$BUILD_DIR/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>export</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>${TEAM_ID}</string>
	<key>uploadSymbols</key>
	<true/>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
</dict>
</plist>
PLIST

redact_log() {
  python3 -c 'import sys,re
text=sys.stdin.read()
text=re.sub(r"AuthKey_[A-Za-z0-9]+\.p8","AuthKey_[redacted].p8",text)
text=re.sub(r"identifier:\s*[A-Za-z0-9]+","identifier: [redacted]",text)
text=re.sub(r"issuer:\s*[0-9a-fA-F-]{8,}","issuer: [redacted]",text)
text=re.sub(r"(authenticationKeyID\s+)\S+",r"\1[redacted]",text)
text=re.sub(r"(authenticationKeyIssuerID\s+)\S+",r"\1[redacted]",text)
text=re.sub(r"(apiKey\s+)\S+",r"\1[redacted]",text)
text=re.sub(r"(apiIssuer\s+)\S+",r"\1[redacted]",text)
text=re.sub(r"(ASC_KEY_ID=)\S+",r"\1[redacted]",text)
text=re.sub(r"(ASC_ISSUER_ID=)\S+",r"\1[redacted]",text)
sys.stdout.write(text)'
}

echo "== 아이폰 아카이브 (맥 앱 아님) =="
rm -rf "$ARCHIVE_PATH"
xcodebuild archive \
  -project ios/LiveInterpret.xcodeproj \
  -scheme LiveInterpret \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  2>&1 | redact_log

echo "== 배포 서명 후 TestFlight 업로드 =="
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  2>&1 | redact_log

IPA="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' -print -quit)"
if [[ -z "$IPA" ]]; then
  echo "아이폰 설치 파일이 없습니다." >&2
  exit 1
fi

echo "== TestFlight 업로드 =="
xcrun altool --upload-app \
  --type ios \
  --file "$IPA" \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID" \
  2>&1 | redact_log

echo "업로드 요청을 보냈습니다. 앱 이름: 실시간 통역 / 번들: ${BUNDLE_ID}"
