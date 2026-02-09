#!/usr/bin/env python3
"""
vizmatic renderer CLI

Reads a project JSON description and renders a composed MP4 via ffmpeg.
MVP pipeline:
  1) Concatenate the listed video clips to a temporary H.264/YUV420p MP4 (video only)
  2) If an audio file is provided, mux it with the concatenated video (shortest wins)

Environment overrides:
  vizmatic_FFMPEG  -> absolute path to ffmpeg binary (default: ffmpeg on PATH)

Usage:
  python renderer/python/main.py <path/to/project.json>
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def load_project(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def validate_project(p: Dict[str, Any]) -> None:
    if p.get("version") != "1.0":
        raise ValueError("Unsupported or missing project version; expected '1.0'.")
    if not isinstance(p.get("clips"), list):
        raise ValueError("Project missing 'clips' list.")


def which(cmd: str) -> Optional[str]:
    from shutil import which as _which
    return _which(cmd)


def ffmpeg_exe() -> str:
    exe = os.environ.get("vizmatic_FFMPEG") or "ffmpeg"
    return exe


def ffprobe_exe() -> str:
    override = os.environ.get("vizmatic_FFPROBE")
    if override:
        return override
    ff = ffmpeg_exe()
    # If ffmpeg path is absolute, try sibling ffprobe
    base = os.path.basename(ff).lower()
    if os.path.sep in ff or (os.path.altsep and os.path.altsep in ff):
        d = os.path.dirname(ff)
        candidate = os.path.join(d, 'ffprobe')
        if os.name == 'nt':
            candidate_exe = candidate + '.exe'
            if os.path.isfile(candidate_exe):
                return candidate_exe
        if os.path.isfile(candidate):
            return candidate
    return 'ffprobe'


def check_ffmpeg() -> bool:
    exe = ffmpeg_exe()
    if not which(exe):
        eprint("[renderer] ffmpeg not found on PATH; set vizmatic_FFMPEG or bundle ffmpeg.")
        return False
    try:
        subprocess.run([exe, "-hide_banner", "-version"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return True
    except Exception as exc:
        eprint(f"[renderer] ffmpeg check failed: {exc}")
        return False


def run_ffmpeg(args: List[str], with_progress: bool = True) -> int:
    cmd = [ffmpeg_exe()] + args
    print("[ffmpeg] ", " ".join(f'"{a}"' if " " in a else a for a in cmd))
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    except FileNotFoundError:
        eprint("[renderer] ffmpeg not found. Set vizmatic_FFMPEG.")
        return 127
    assert proc.stdout is not None
    for line in proc.stdout:
        print(line.rstrip())
    return proc.wait()


def ensure_tmp_dir(base: str) -> str:
    d = os.path.join(base, "vizmatic")
    os.makedirs(d, exist_ok=True)
    return d


def write_concat_list(path_list: List[str], dest_file: str) -> None:
    # ffmpeg concat demuxer expects: file '<path>' per line; use -safe 0
    with open(dest_file, "w", encoding="utf-8") as f:
        for p in path_list:
            # Escape single quotes
            q = p.replace("'", "'\\''")
            f.write(f"file '{q}'\n")


def concat_videos_to_h264(work_dir: str, clips: List[str]) -> Tuple[int, str]:
    """Produces a temporary MP4 with H.264 video only. Returns (code, path)."""
    list_path = os.path.join(work_dir, "concat.txt")
    out_path = os.path.join(work_dir, "concat_video.mp4")
    write_concat_list(clips, list_path)
    args = [
        "-hide_banner",
        "-y",
        "-nostats",
        "-progress",
        "pipe:1",
        "-safe",
        "0",
        "-f",
        "concat",
        "-i",
        list_path,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        out_path,
    ]
    code = run_ffmpeg(args)
    return code, out_path


def build_clip_filter_chain(clip: Dict[str, Any]) -> Optional[str]:
    parts: List[str] = []
    hue = clip.get("hue")
    if hue is not None:
        try:
            hue_val = float(hue)
            if abs(hue_val) > 0.001:
                parts.append(f"hue=h={hue_val}")
        except Exception:
            pass
    contrast = clip.get("contrast")
    brightness = clip.get("brightness")
    if contrast is not None or brightness is not None:
        try:
            c_val = float(contrast) if contrast is not None else 1.0
            b_val = float(brightness) if brightness is not None else 1.0
            b_val = max(-1.0, min(1.0, b_val - 1.0))
            parts.append(f"eq=contrast={c_val}:brightness={b_val}")
        except Exception:
            pass
    rotate = clip.get("rotate")
    if rotate is not None:
        try:
            rot_val = float(rotate)
            if abs(rot_val) > 0.001:
                radians = rot_val * 3.14159265 / 180.0
                parts.append(f"rotate={radians}:fillcolor=black")
        except Exception:
            pass
    if clip.get("flipH"):
        parts.append("hflip")
    if clip.get("flipV"):
        parts.append("vflip")
    if clip.get("invert"):
        parts.append("negate")
    if not parts:
        return None
    return ",".join(parts)


def render_blank_clip(work_dir: str, duration: float, size: Tuple[int, int]) -> str:
    out_path = os.path.join(work_dir, f"gap_{int(duration * 1000)}ms.mp4")
    width, height = size
    args = [
        "-hide_banner",
        "-y",
        "-nostats",
        "-progress",
        "pipe:1",
        "-f",
        "lavfi",
        "-i",
        f"color=c=black:s={width}x{height}:d={duration}",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        out_path,
    ]
    code = run_ffmpeg(args)
    if code != 0:
        raise RuntimeError(f"Failed to render blank clip ({code})")
    return out_path


def render_clip_segment(work_dir: str, clip: Dict[str, Any], idx: int) -> str:
    path = clip.get("path")
    if not path:
        raise ValueError("Missing clip path")
    trim_start = float(clip.get("trimStart") or 0)
    trim_end = clip.get("trimEnd")
    trim_end_val = float(trim_end) if trim_end is not None else None
    duration = float(clip.get("duration") or 0)
    fill_method = str(clip.get("fillMethod") or "loop").lower()
    seg_len = None
    if trim_end_val is not None:
        seg_len = max(0.0, trim_end_val - trim_start)
    loop = bool(seg_len and duration > seg_len + 0.01 and fill_method == "loop")
    out_path = os.path.join(work_dir, f"clip_{idx:04d}.mp4")

    if fill_method == "pingpong" and seg_len:
        cycle_path = os.path.join(work_dir, f"clip_{idx:04d}_pp.mp4")
        chain = build_clip_filter_chain(clip)
        trim_expr = f"trim=start={trim_start:.3f}:end={trim_end_val:.3f}"
        base_chain = f"{trim_expr},setpts=PTS-STARTPTS"
        if chain:
            base_chain = f"{base_chain},{chain}"
        filter_complex = f"[0:v]{base_chain}[f];[f]reverse,setpts=PTS-STARTPTS[r];[f][r]concat=n=2:v=1:a=0[v]"
        args = [
            "-hide_banner",
            "-y",
            "-nostats",
            "-progress",
            "pipe:1",
            "-i",
            path,
            "-filter_complex",
            filter_complex,
            "-map",
            "[v]",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            cycle_path,
        ]
        code = run_ffmpeg(args)
        if code != 0:
            raise RuntimeError(f"Clip render failed ({code})")

        cycle_len = seg_len * 2.0
        args = [
            "-hide_banner",
            "-y",
            "-nostats",
            "-progress",
            "pipe:1",
        ]
        if duration > cycle_len + 0.01:
            args += ["-stream_loop", "-1"]
        args += ["-i", cycle_path]
        if duration > 0:
            args += ["-t", f"{duration:.3f}"]
        args += [
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            out_path,
        ]
        code = run_ffmpeg(args)
        if code != 0:
            raise RuntimeError(f"Clip render failed ({code})")
        return out_path
    args = [
        "-hide_banner",
        "-y",
        "-nostats",
        "-progress",
        "pipe:1",
    ]
    if loop:
        args += ["-stream_loop", "-1"]
    if trim_start > 0:
        args += ["-ss", f"{trim_start:.3f}"]
    if trim_end_val is not None and trim_end_val > trim_start:
        args += ["-to", f"{trim_end_val:.3f}"]
    args += ["-i", path]
    if duration > 0:
        args += ["-t", f"{duration:.3f}"]
    args += ["-an"]
    chain = build_clip_filter_chain(clip)
    if fill_method == "stretch" and seg_len and duration > 0:
        try:
            ratio = max(0.05, float(duration) / float(seg_len))
            stretch = f"setpts=PTS*{ratio:.6f}"
            chain = f"{chain},{stretch}" if chain else stretch
        except Exception:
            pass
    if chain:
        args += ["-vf", chain]
    args += [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        out_path,
    ]
    code = run_ffmpeg(args)
    if code != 0:
        raise RuntimeError(f"Clip render failed ({code})")
    return out_path

def mux_audio_video(temp_video: str, audio_path: Optional[str], output_path: str, layers: List[Dict[str, Any]], canvas: Optional[Tuple[int, int]] = None) -> int:
    has_audio = bool(audio_path)
    filter_complex, vlabel = build_layer_filters(layers, has_audio=has_audio, canvas=canvas)
    args = [
        "-hide_banner",
        "-y",
        "-nostats",
        "-progress",
        "pipe:1",
        "-i",
        temp_video,
    ]
    if has_audio:
        args += ["-i", audio_path]
    if filter_complex:
        args += ["-filter_complex", filter_complex, "-map", vlabel]
        if has_audio:
            args += ["-map", "1:a"]
    else:
        args += ["-map", "0:v"]
        if has_audio:
            args += ["-map", "1:a"]
    args += [
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
    ]
    if has_audio:
        args += [
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
        ]
    args.append(output_path)
    return run_ffmpeg(args)


def hex_to_rgb(color: str) -> str:
    if not color:
        return "0xFFFFFF"
    c = color.strip()
    if c.startswith("#"):
        c = c[1:]
    if len(c) == 3:
        c = "".join([ch * 2 for ch in c])
    if len(c) != 6:
        return "0xFFFFFF"
    return "0x" + c.upper()


def parse_hex_color(color: str) -> Tuple[int, int, int]:
    if not color:
        return (255, 255, 255)
    c = color.strip()
    if c.startswith("#"):
        c = c[1:]
    if len(c) == 3:
        c = "".join([ch * 2 for ch in c])
    if len(c) != 6:
        return (255, 255, 255)
    try:
        r = int(c[0:2], 16)
        g = int(c[2:4], 16)
        b = int(c[4:6], 16)
        return (r, g, b)
    except Exception:
        return (255, 255, 255)


def escape_text(txt: str) -> str:
    return txt.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def resolve_font_file(font: str) -> Optional[str]:
    if not font:
        return None
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "client", "public", "fonts"))
    candidates = [
        f"{font}.ttf",
        f"{font.replace(' ', '')}.ttf",
        f"{font.replace(' ', '-')}.ttf",
    ]
    for name in candidates:
        path = os.path.join(base_dir, name)
        if os.path.isfile(path):
            normalized = path.replace("\\", "/")
            return normalized.replace(":", r"\:")
    return None


def escape_filter_path(path: str) -> str:
    normalized = path.replace("\\", "/")
    normalized = normalized.replace(":", r"\:")
    normalized = normalized.replace("'", r"\'")
    return normalized


def escape_geq_expr(expr: str) -> str:
    return expr.replace("\\", "\\\\").replace(":", "\\:").replace(",", "\\,")


def build_layer_filters(layers: List[Dict[str, Any]], has_audio: bool, canvas: Optional[Tuple[int, int]] = None) -> Tuple[Optional[str], str]:
    """Return (filter_complex, video_label)"""
    if not layers and not canvas:
        return None, "[0:v]"

    filter_parts: List[str] = []
    current_v = "[0:v]"
    if canvas:
        cw, ch = canvas
        filter_parts.append(
            f"{current_v}scale=w={cw}:h={ch}:force_original_aspect_ratio=decrease,"
            f"pad=w={cw}:h={ch}:x=(ow-iw)/2:y=(oh-ih)/2:color=black[v0]"
        )
        current_v = "[v0]"

    spec_layers = [l for l in layers if l.get("type") == "spectrograph"]
    if spec_layers and has_audio:
        split = f"[1:a]asplit={len(spec_layers)}" + "".join([f"[as{idx}]" for idx in range(len(spec_layers))])
        filter_parts.append(split)

    spec_idx = 0
    for idx, layer in enumerate(layers):
        lid = idx + 1
        if layer.get("type") == "spectrograph":
            if not has_audio:
                continue
            mode = layer.get("mode") or "bar"
            path_mode = layer.get("pathMode") or "straight"
            x = float(layer.get("x", 0) or 0)
            y = float(layer.get("y", 0) or 0)
            spec_tag = f"[spec{idx}]"
            w = int(layer.get("width") or 640)
            h = int(layer.get("height") or 200)
            opacity = float(layer.get("opacity") or 1.0)
            invert = bool(layer.get("invert"))
            base_w = w
            try:
                if mode == "dots":
                    base_w = int(layer.get("dotCount") or w)
                elif mode == "solid":
                    base_w = int(layer.get("solidPointCount") or w)
                else:
                    base_w = int(layer.get("barCount") or w)
            except Exception:
                base_w = w
            if base_w <= 0:
                base_w = w
            color_value = layer.get("color") or ""
            tint = parse_hex_color(color_value) if color_value else None
            if mode == "line":
                spec_chain = f"[as{spec_idx}]showfreqs=mode=line:ascale=log:win_size=2048:size={base_w}x{h}"
            elif mode == "dots":
                spec_chain = f"[as{spec_idx}]showfreqs=mode=dot:ascale=log:win_size=2048:size={base_w}x{h}"
            elif mode == "solid":
                spec_chain = f"[as{spec_idx}]showspectrum=s={base_w}x{h}:mode=combined:color=intensity:scale=log:win_func=hann"
            else:
                spec_chain = f"[as{spec_idx}]showfreqs=mode=bar:ascale=log:win_size=2048:size={base_w}x{h}"
            if base_w != w:
                spec_chain += f",scale=w={w}:h={h}:flags=neighbor"
            if mode == "bar":
                try:
                    bar_width = float(layer.get("barWidthPct") or 0)
                except Exception:
                    bar_width = 0
                if bar_width and bar_width < 1.0:
                    narrow_w = max(1, int(w * bar_width))
                    spec_chain += f",scale=w={narrow_w}:h={h}:flags=neighbor,pad=w={w}:h={h}:x=(ow-iw)/2:y=0:color=black@0"
            if tint:
                r, g, b = tint
                spec_chain += f",format=gray,format=rgb24,lutrgb=r='val*{r}/255':g='val*{g}/255':b='val*{b}/255'"
            if invert:
                spec_chain += ",vflip"
            if opacity < 1.0:
                spec_chain += f",format=rgba,colorchannelmixer=aa={opacity}"
            if path_mode == "circular":
                rad = "hypot(X-W/2,Y-H/2)"
                ang = "(atan2(Y-H/2,X-W/2)+PI)/(2*PI)*W"
                ry = f"{rad}/(min(W,H)/2)*H"
                expr = f"if(lte({rad},min(W,H)/2),p({ang},{ry}),0)"
                expr = escape_geq_expr(expr)
                spec_chain += f",geq=r='{expr}':g='{expr}':b='{expr}'"
            filter_parts.append(f"{spec_chain}{spec_tag}")
            filter_parts.append(
                f"{current_v}{spec_tag}overlay=x=W*{x}:y=H*{y}:format=auto[v{lid}]"
            )
            current_v = f"[v{lid}]"
            spec_idx += 1
        elif layer.get("type") == "image":
            path = layer.get("imagePath")
            if not path:
                continue
            x = float(layer.get("x", 0) or 0)
            y = float(layer.get("y", 0) or 0)
            width = int(layer.get("width") or 100)
            height = int(layer.get("height") or 100)
            opacity = float(layer.get("opacity") or 1.0)
            rotate = float(layer.get("rotate") or 0)
            reverse = bool(layer.get("reverse"))
            invert = bool(layer.get("invert"))
            outline_w = int(layer.get("outlineWidth") or 0)
            outline_color = hex_to_rgb(layer.get("outlineColor") or "#000000")
            glow_amount = int(layer.get("glowAmount") or 0)
            glow_opacity = float(layer.get("glowOpacity") or 0.4)
            glow_color = hex_to_rgb(layer.get("glowColor") or "#000000")
            shadow_distance = int(layer.get("shadowDistance") or 0)
            shadow_color = hex_to_rgb(layer.get("shadowColor") or "#000000")
            step = 0
            img_tag = f"[img{idx}]"
            img_path = escape_filter_path(path)
            img_chain = f"movie='{img_path}':loop=0,scale=w={width}:h={height}:flags=lanczos,format=rgba"
            if rotate:
                radians = rotate * 3.14159265 / 180.0
                img_chain += f",rotate={radians}:fillcolor=black@0"
            if reverse:
                img_chain += ",hflip"
            if invert:
                img_chain += ",negate"
            if opacity < 1.0:
                img_chain += f",colorchannelmixer=aa={opacity}"
            filter_parts.append(f"{img_chain}{img_tag}")

            def overlay_with(tag: str, xoff: float = 0.0, yoff: float = 0.0) -> None:
                nonlocal current_v, step
                step += 1
                next_v = f"[v{idx}_{step}]"
                filter_parts.append(f"{current_v}{tag}overlay=x=W*{x}+{xoff}:y=H*{y}+{yoff}:format=auto:repeatlast=1{next_v}")
                current_v = next_v

            if shadow_distance > 0:
                sh_tag = f"[imgsh{idx}]"
                filter_parts.append(f"{img_tag}boxblur=lr={max(1, shadow_distance//2)}:lp=1,colorchannelmixer=aa=0.6{sh_tag}")
                overlay_with(sh_tag, shadow_distance, shadow_distance)
            if glow_amount > 0:
                glow_tag = f"[imggl{idx}]"
                filter_parts.append(f"{img_tag}boxblur=lr={max(1, glow_amount//2)}:lp=1,colorchannelmixer=aa={glow_opacity}{glow_tag}")
                overlay_with(glow_tag, 0, 0)
            if outline_w > 0:
                ol_tag = f"[imgol{idx}]"
                filter_parts.append(f"{img_tag}pad=w=iw+{outline_w*2}:h=ih+{outline_w*2}:x={outline_w}:y={outline_w}:color={outline_color}@1.0{ol_tag}")
                overlay_with(ol_tag, -outline_w, -outline_w)
            overlay_with(img_tag, 0, 0)
        elif layer.get("type") == "text":
            text = escape_text(layer.get("text") or "Text")
            opacity = float(layer.get("opacity") or 1.0)
            color = hex_to_rgb(layer.get("color") or "#ffffff") + f"@{opacity:.3f}"
            font = escape_text(layer.get("font") or "Segoe UI")
            fontfile = resolve_font_file(layer.get("font") or "")
            fontsize = int(layer.get("fontSize") or 12)
            x = float(layer.get("x", 0) or 0)
            y = float(layer.get("y", 0) or 0)
            outline_color = hex_to_rgb(layer.get("outlineColor") or "#000000") + f"@{opacity:.3f}"
            outline_width = max(0, int(layer.get("outlineWidth") or 0))
            shadow_alpha = max(0.0, min(1.0, opacity * 0.6))
            shadow_color = hex_to_rgb(layer.get("shadowColor") or "#000000") + f"@{shadow_alpha:.3f}"
            shadow_distance = int(layer.get("shadowDistance") or 0)
            font_arg = f":fontfile='{fontfile}'" if fontfile else f":font='{font}'"
            filter_parts.append(
                f"{current_v}drawtext=text='{text}':fontcolor={color}:fontsize={fontsize}{font_arg}:x=W*{x}:y=H*{y}:bordercolor={outline_color}:borderw={outline_width}:shadowcolor={shadow_color}:shadowx={shadow_distance}:shadowy={shadow_distance}[v{lid}]"
            )
            current_v = f"[v{lid}]"

    return ";".join(filter_parts), current_v or "[0:v]"


def ffprobe_duration_ms(path: str) -> Optional[int]:
    exe = ffprobe_exe()
    try:
        proc = subprocess.run([
            exe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        s = proc.stdout.strip()
        if not s:
            return None
        sec = float(s)
        if not (sec >= 0):
            return None
        return int(sec * 1000)
    except Exception:
        return None


def main(argv: List[str]) -> int:
    if len(argv) != 2:
        eprint("Usage: python renderer/python/main.py <path/to/project.json>")
        return 2

    project_path = argv[1]
    if not os.path.isfile(project_path):
        eprint(f"[renderer] Project JSON not found: {project_path}")
        return 2

    try:
        project = load_project(project_path)
        validate_project(project)
    except Exception as exc:
        eprint(f"[renderer] Invalid project JSON: {exc}")
        return 2

    audio = (project.get("audio") or {}).get("path")
    clip_entries = [c for c in (project.get("clips") or []) if isinstance(c, dict) and c.get("path")]
    output = (project.get("output") or {}).get("path")
    layers = project.get("layers") or []
    metadata = project.get("metadata") or {}
    canvas_meta = metadata.get("canvas") if isinstance(metadata, dict) else None
    canvas_size: Optional[Tuple[int, int]] = None
    if isinstance(canvas_meta, dict):
        try:
            cw = int(canvas_meta.get("width") or 0)
            ch = int(canvas_meta.get("height") or 0)
            if cw > 0 and ch > 0:
                canvas_size = (cw, ch)
        except Exception:
            canvas_size = None

    print("[renderer] Loaded project")
    print(f"  audio: {audio or 'none'}")
    print(f"  clips: {len(clip_entries)}")
    for idx, c in enumerate(clip_entries):
        print(f"    - index={idx} path={c.get('path')}")
    print(f"  output: {output or '(not specified)'}")
    print(f"  layers: {len(layers)}")

    if not clip_entries:
        eprint("[renderer] No clips provided; nothing to render.")
        return 2
    if not output:
        # default next to project JSON
        root, _ = os.path.splitext(project_path)
        output = root + "_render.mp4"
        print(f"[renderer] No output specified; defaulting to {output}")

    if not check_ffmpeg():
        eprint("[renderer] ffmpeg not available; aborting.")
        return 2

    # Validate paths
    for c in clip_entries:
        p = c.get("path")
        if not p or not os.path.isfile(p):
            eprint(f"[renderer] Missing clip: {p}")
            return 2
    if audio and not os.path.isfile(audio):
        eprint(f"[renderer] Missing audio file: {audio}")
        return 2

    # Estimate total duration from clips
    total_ms = 0
    for c in clip_entries:
        p = c.get("path")
        if not p:
            continue
        d = ffprobe_duration_ms(p)
        if d is not None:
            total_ms += d
    if total_ms > 0:
        print(f"total_duration_ms={total_ms}")

    work_dir = ensure_tmp_dir(os.path.join(os.path.dirname(project_path), ".vizmatic"))
    clip_jobs: List[Dict[str, Any]] = []
    cursor = 0.0
    for idx, c in enumerate(clip_entries):
        path = c.get("path")
        if not path:
            continue
        trim_start = float(c.get("trimStart") or 0)
        trim_end = c.get("trimEnd")
        trim_end_val = float(trim_end) if trim_end is not None else None
        if trim_end_val is not None and trim_end_val < trim_start:
            trim_end_val = trim_start
        duration = c.get("duration")
        if duration is None:
            if trim_end_val is not None:
                duration = max(0.05, trim_end_val - trim_start)
            else:
                d = ffprobe_duration_ms(path)
                if d is not None:
                    duration = max(0.05, d / 1000.0 - trim_start)
                else:
                    duration = 0.0
        try:
            duration_val = max(0.05, float(duration))
        except Exception:
            duration_val = 0.05
        if trim_end_val is None:
            d = ffprobe_duration_ms(path)
            if d is not None:
                trim_end_val = max(trim_start, d / 1000.0)
        start_val = c.get("start")
        if isinstance(start_val, (int, float)):
            start_val = max(cursor, float(start_val))
        else:
            start_val = cursor
        clip_jobs.append({
            "path": path,
            "start": start_val,
            "duration": duration_val,
            "trimStart": trim_start,
            "trimEnd": trim_end_val,
            "fillMethod": c.get("fillMethod") or "loop",
            "hue": c.get("hue"),
            "contrast": c.get("contrast"),
            "brightness": c.get("brightness"),
            "rotate": c.get("rotate"),
            "flipH": c.get("flipH"),
            "flipV": c.get("flipV"),
            "invert": c.get("invert"),
        })
        cursor = max(cursor, start_val + duration_val)

    render_paths: List[str] = []
    current = 0.0
    if not canvas_size:
        canvas_size = (1920, 1080)
    for idx, clip in enumerate(clip_jobs):
        start_val = float(clip.get("start") or 0)
        if start_val > current + 0.001:
            gap = start_val - current
            render_paths.append(render_blank_clip(work_dir, gap, canvas_size))
            current += gap
        render_paths.append(render_clip_segment(work_dir, clip, idx))
        current += float(clip.get("duration") or 0)

    code, tmp_video = concat_videos_to_h264(work_dir, render_paths)
    if code != 0:
        eprint(f"[renderer] Concat stage failed with code {code}")
        return code

    if audio or layers or canvas_size:
        code = mux_audio_video(tmp_video, audio, output, layers, canvas=canvas_size)
        if code != 0:
            eprint(f"[renderer] Mux stage failed with code {code}")
            return code
    else:
        # No audio/layers: move temp video to output
        try:
            if os.path.abspath(tmp_video) != os.path.abspath(output):
                os.replace(tmp_video, output)
        except Exception as exc:
            eprint(f"[renderer] Failed to move temp video to output: {exc}")
            return 1

    print("[renderer] Render complete:", output)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
