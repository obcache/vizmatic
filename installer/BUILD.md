# Build & Package Checklist (Windows)

This is a quick, memory-jogger guide for a full build, preflight checks, and Inno Setup compilation.

## 1) Preflight
- Verify repo deps: `npm install`
- Confirm these paths in `installer/windows/setup.iss`:
  - `AppBinDir` -> release output (electron-packager)
  - `RendererBinDir` -> `renderer/python/dist`
  - `VendorRedistDir` -> `vendor/windows/redist`
  - `LogoFile`, `IconFile`, `ShortcutFile` -> current UI asset paths
- Ensure ffmpeg/ffprobe are present in `vendor/windows/redist`
- Ensure the renderer binary exists (see step 3)

## 2) Build Electron + Renderer UI
- Clean + build: `npm run build`
  - Builds electron main process to `dist-electron`
  - Builds client UI to `dist`

## 3) Build the Python renderer (if needed)
- If not already built: build with your existing renderer tooling (PyInstaller output should end up in `renderer/python/dist`)
- Confirm: `renderer/python/dist/vizmatic-renderer.exe`

## 4) Package the Electron app
- `npm run package:win`
  - Output in `release/vizmatic-win32-x64`

## 5) Inno Setup compile
- Open `installer/windows/setup.iss` in Inno Setup
- Build/Compile (or CLI):
  - `ISCC.exe installer/windows/setup.iss`
- Output EXE goes to `installer/windows/out`

## 6) Smoke test
- Run the installer EXE
- Launch the app, load a test project, and do a quick render

