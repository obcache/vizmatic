# Manual QA

Note: Environment remediation tasks and a running development journal now live in `docs/dev-ledger.md`.

## Project Load/Save + Dirty Tracking

- Launch the app and click `Load Project...`.
  - Choose a valid project JSON; UI should update (audio path, storyboard order, playhead, project path).
- Modify the project (e.g., reorder a clip or change audio).
  - Close the window; expect prompt: Save / Discard / Cancel.
  - Choose Cancel to stay; choose Save to pick a path if there is none and write JSON; app then exits.
- With no changes (clean state), closing should exit immediately.

## Render Flow (Progress + Cancel)

- Load or create a project with at least one video clip. Optionally set an audio file.
- Click `Render`. Expect:
  - Log lines appear in the Project log console.
  - Progress bar fills; ETA shows if durations were probed.
  - On success, status reads "Render complete." and process exits 0.
- Click `Cancel` while rendering.
  - Expect renderer termination and status "Render cancelled.".
- Attempt to close the window while rendering.
  - Expect prompt: Stop Render / Cancel. Choose Stop Render to terminate and continue with save prompt if dirty.

Environment variables (for dev):
- `vizmatic_PYTHON` to select Python interpreter (e.g., `C:\\Python39\\python.exe`).
- `vizmatic_FFMPEG` absolute path to ffmpeg binary.
- `vizmatic_FFPROBE` absolute path to ffprobe binary.

## Electron session persistence (nodeIntegration disabled)

1. Launch the Electron application with `npm run electron`.
2. Confirm the developer tools show `nodeIntegration: false` for the renderer process.
3. Enter some text into the "Session Notes" textarea.
4. Click **Save Session** and confirm the status message switches to "Session saved.".
5. Quit and relaunch the app; the previously saved notes should load automatically, confirming `loadSessionState` works through the preload bridge.
6. Click **Export Session** and provide an absolute path (e.g., `/tmp/vizmatic-session.json`).
7. Verify the export file exists and contains the JSON session payload.

## Browser UI previews / Storybook

The renderer can run outside of Electron (for example Storybook or static UI previews). Set the environment flag
`VITE_vizmatic_USE_ELECTRON_BRIDGE_MOCK=true` (or `vizmatic_USE_ELECTRON_BRIDGE_MOCK=true` when booting through Node) and
start the dev server in development mode to opt into a safe mock implementation of the Electron bridge APIs. For setups
without a Node runner you can declare `window.vizmatic_USE_ELECTRON_BRIDGE_MOCK = true` (or the Vite-prefixed variant) in a
bootstrap script before the bundle loads. With the flag enabled, `loadSessionState`, `saveSessionState`, and
`exportSession` become no-ops so that UI workflows continue to function without a preload script. The mock is disabled by
default to avoid impacting production Electron builds.
