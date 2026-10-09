# n1cebear's toolbox (formerly "Trading Hall")

Static, no-build PWA of Minecraft tools (Hall planner, Enchanting, Trims, Builds, Portal). Vanilla JS modules under `js/`, CSS under `css/`, global namespace `TH`. Deployed from `main` via GitHub Pages (`origin` = github.com/n1cebear/trading-hall; the repo is not yet renamed).

**Read `DESIGN.md` first** and follow it (its "Open items" section is the handoff state). User rules: one main colour per tool; no divider lines; no box-in-box; app tooltips; no re-render animations on clicks; test Classic + Pixel + Soft, dark + light, desktop + 390px.

## Run / ship
- Preview: `node tools/serve.js` (http://localhost:5173), or the `toolbox` config in `.claude/launch.json`.
- Save a version: `powershell -ExecutionPolicy Bypass -File tools/push.ps1 "message"` (syntax check, bumps `sw.js` cache, commits). Add `-Push` for a major step (pushes to `main`, Pages deploys). Every commit also gets a line in the control-room artifact (https://claude.ai/artifact/AxRwKs5zWjUiopvcf8wppj); GitHub only gets major steps.
- Always bump the `sw.js` cache when changing shipped files, or installed copies keep the old version.

## Compatibility notes
- localStorage key `tradingHall.state` and the export `app: 'trading-hall'` stay as they are so existing saves and backups keep loading. Do not rename without a migration.

## The toolbox as a claude.ai artifact
Whole app: https://claude.ai/artifact/3LYSYQoFMVxShDjtCzdzhS (private). It runs fully offline: textures are bundled (`assets/mc/`, git-ignored) because an artifact page may only load its own files.
- First time / new textures: `node tools/build-icon-list.js && node tools/fetch-icons.js && node tools/fetch-artifact-assets.js`.
- Every update: `node tools/build-artifact.js`. It writes `dist-artifact/index.html` (the page) and `dist-artifact/files-N.json` (only NEW or CHANGED files vs `dist-artifact/manifest.json`, 250 per publish). Publish `dist-artifact/index.html` with the Artifact tool (`url` = the link above) and pass each `files-N.json` as `files`, one publish per file. Then `mv dist-artifact/manifest.next.json dist-artifact/manifest.json`.
- The page sets `window.TH_LOCAL_ASSETS = true` (icons.js uses local textures, app.js skips the service worker). Not available in the artifact: username skin lookups (Trims "Player" tab) and the language files beyond the 25 most common.
- Control room (links, commands, version log): https://claude.ai/artifact/AxRwKs5zWjUiopvcf8wppj
