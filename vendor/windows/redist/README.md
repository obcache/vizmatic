# Windows Redist: ffmpeg/ffprobe

Place Windows builds of ffmpeg and ffprobe in this folder so the installer can bundle them under `{app}\redist`.

Required binaries
- `ffmpeg.exe`
- `ffprobe.exe`

Recommended sources
- Official: https://ffmpeg.org/download.html
- Community builds (popular):
  - Gyan.dev: https://www.gyan.dev/ffmpeg/builds/
  - BtbN: https://github.com/BtbN/FFmpeg-Builds

Licensing and compliance
- FFmpeg is licensed under LGPL v2.1 or GPL v2 depending on configuration.
- Some builds include GPL components/codecs; bundling those may impose GPL obligations on your distribution.
- You must include license notices from the binary distribution you ship. Place the provided license files here so the installer copies them to `{app}\redist\licenses`:
  - `LICENSE.txt` (or similar)
  - `COPYING.LGPLv2.1`, `COPYING.GPLv3` (if provided)
  - Any accompanying `README.txt` that contains attribution/terms

Notes
- The app prefers `{app}\redist` for ffmpeg/ffprobe; no PATH changes required.
- You can override at runtime via environment variables `vizmatic_FFMPEG` and `vizmatic_FFPROBE`.
- If you choose not to redistribute ffmpeg/ffprobe, remove them from the installer and ensure they are available on PATH or set the env vars accordingly.

