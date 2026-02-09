# vizmatic User Guide

## Overview
vizmatic is a music visualizer generator that lets you assemble videos, audio, and visualizer/text layers into a final render. It provides:
- Project-based workflows (save/load).
- Audio + video timeline assembly.
- Visualizer (spectrogram) and text overlays.
- Render pipeline using ffmpeg.

## Glossary
- Stage: The active canvas area (16:9 or 9:16) where video and layers are composited.
- Canvas: The fixed output resolution (1920x1080 or 1080x1920) used for preview and render.
- Preview: The live, in-app view of the current playhead frame.
- Timeline: The horizontal time scale shared by the waveform and storyboard.
- Storyboard: The clip strip under the waveform showing video segments over time.
- Playhead: The current time indicator used for preview and render.
- Layer: A visual element that sits on top of video (spectrograph, text, image, particles).
- Spectrograph: The audio visualizer generated from the audio frequency data.
- Render: The final export operation that writes a video file.

## Quick Start
1) Create a new project (File > New Project).
2) Load audio (Media > Load Audio...).
3) Add one or more video clips (Media > Add Videos...).
4) Add layers (Layers > Add Visualizer / Add Text).
5) Adjust layer and clip properties.
6) Save the project and render.

## Project Basics
- Unsaved projects show as: `vizmatic - Unsaved Project *` in the title bar.
- Save often. Rendering uses the saved project JSON.

### Save and Load
- Save: File > Save
- Save As: File > Save As...
- Open: File > Open Project...

## Media Section
### Audio
- Load Audio: Media > Load Audio...
- Audio controls are shown in the overview waveform.
- The playhead reflects the current preview time.

### Video Clips
- Add videos: Media > Add Videos...
- Add from library: Media > Add From Library...

## Storyboard (Video Timeline)
Each clip appears as a segment in the storyboard below the audio waveform.

### Drag to Reorder
Drag a clip to reorder it in the timeline.

### Trim and Loop
- Left handle: adjusts trim start (in-point).
- Right handle: adjusts segment duration (can extend beyond the clip to loop).
- Short clips can shrink to just a few pixels so timing stays accurate.

### Clip Context Menu
Right-click a clip for:
- Rename
- Edit (properties)
- Add to Library
- Duplicate
- File Info
- Remove

### Clip Properties (Double-Click or Edit)
Open the clip properties modal to edit:
- Timeline Start/End (position in the overall timeline)
- Trim Start/End (source in/out)
- Hue / Contrast / Brightness
- Rotate / Flip H / Flip V / Invert

## Preview
- The Preview panel shows the current playhead frame.
- Canvas size is locked to the selected orientation:
  - Landscape: 1920x1080
  - Portrait: 1080x1920
- Clips are centered within the canvas while preserving aspect ratio.

## Layers
Layers overlay on top of video:
- Spectrograph (Visualizer)
- Text

### Adding Layers
Use the Layers header buttons to add Visualizer or Text.

### Selecting a Layer
The selected layer is highlighted in the list and its properties panel background matches the layer color.

### Layer Properties (Shared)
- Color
- Outline / Glow / Shadow
- X (%) / Y (%)
- Rotate
- Transparency
- Reverse (horizontal flip)

### Spectrograph (Visualizer) Layer
Properties include:
- Type (Standard Spectrograph)
- Mode (Bar/Line/Solid/Dots)
- Width / Height
- Low Cut / High Cut
- Invert

Notes:
- Spectrograph preview uses the audio waveform amplitude, not the UI volume slider.

### Text Layer
Properties include:
- Text content
- Font selection
- Font size

## Canvas Orientation
Project header includes:
- Landscape button (1920x1080)
- Portrait button (1080x1920)

Switching orientation changes the output canvas size for preview and render.

## Timeline Zoom and Scroll
Use the zoom controls in the Media header:
- Zoom in/out buttons
- Fit button

The scrollbar under the waveform changes horizontal scroll.

## Render
### Start Render
Project > Render button or File > Render.

### Cancel Render
Project > Cancel or File > Cancel Render.

### Output Location
You are prompted for an output file name. A temporary `render.json` is created in a `.vizmatic` folder alongside the project.

## Media Library
The Media Library lets you store reusable clips:
- Add entries from the Add Video dialog or by right-clicking a clip.
- Select an entry to see metadata.
- Remove entries when no longer needed.

## Licensing
The Project section shows licensing status and upgrade prompts.
- Trial mode blocks rendering and save operations.
- Use the activation modal to enter a license key.

## Menubar (Main Actions)
File:
- New Project
- Open Project...
- Save
- Save As...
- Render
- Cancel Render
Media:
- Load Audio...
- Add Videos...
- Add From Library...
Layers:
- Add Visualizer
- Add Text
View:
- Zoom In
- Zoom Out
- Zoom Fit
Help:
- About vizmatic

## Tips
- For very short clips, zoom in to reveal labels and durations.
- Use Trim Start/End for non-destructive cropping.
- Increase segment duration to loop a clip.

## Troubleshooting
### Render fails with font errors
Ensure the font is in `client/public/fonts` and the font name matches the UI dropdown.

### Spectrograph not visible
Verify audio is loaded and a spectrograph layer exists. If needed, press Play once to initialize audio.

### Missing media
If a file path is missing, the clip will highlight and renders may fail. Re-add the file or update the path.
