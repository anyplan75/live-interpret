# LI-79 gz sidecars (mirror notes)

Primary sidecars + expand live under `scripts/li79-gz/` and `scripts/expand-li79-gz.js`.

Mac apply:

```bash
node scripts/expand-li79-gz.js
```

This directory keeps `expand.js` (same join logic, reads `.agent-upload/gz`) and
`docs__js__desk-client.js.b64`. Engine/main/renderer/guide parts were uploaded
under `scripts/li79-gz/` as numbered `.N.b64` slices to stay under MCP embed limits.
