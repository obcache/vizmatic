# Vizmatic Backlog (Normalized)

Source: User-added

## New Items (need to be appropriately integrated into the planning)

- bind mouse wheel up/down to +/- value for selected control (especially sliders)
- bind cursor keys to:
 - left: x-
 - right: x+
 - up: y-
 - down: y+
 
Source: consolidated from iterative QA/UX notes.

## P0 - Functional Bugs / Regressions

- [ ] Fix preview restore bug after collapse/expand.
  - Current behavior: when Preview is collapsed then expanded, canvas can stay blank until full app window resize.
- [ ] Fix layer glow/shadow interaction.
  - Current behavior: non-zero shadow causes glow color to shift to shadow color.
  - Expected: glow, shadow, and outline are independently applied.
- [ ] Fix mirror behavior (`mirrorX`, `mirrorY`) to be true mirrored replacement.
  - Current behavior doubles content.
  - Expected: mirrored halves/quarters replace hidden regions (kaleidoscope behavior).
- [ ] Fix layer type change persistence.
  - Current behavior: switching layer type is not always auto-saved or preview-refreshed.
- [ ] Keep trial lock coverage correct in Project header.
  - Orientation must remain available in trial.
  - Render must remain locked while unlicensed.

## P1 - Timeline / Clip Editing UX

- [ ] Redesign clip handlebars for very short clips.
  - Show handles only on hover.
  - Draw handles outside clip bounds so no minimum clip width is required.
- [ ] Add ALT-modifier trim mode on clip handle drag.
  - Default drag: adjusts timeline in/out (`punch-in`, `punch-out`), with internal trim auto-adjust only when needed.
  - `ALT + drag`: adjusts internal clip trim directly.
- [ ] Add internal-trim shading overlay on clip segment.
  - Show how trim occupies timeline width.
  - In loop-fill cases, visualize repeated/filled portion vs trimmed source span.

## P1 - Layer Panel UX / Structure

- [ ] Move layer properties panel above layer list (below add-layer buttons).
- [ ] Auto-select newly duplicated layer after `Duplicate`.
- [ ] Improve selected-layer emphasis:
  - Keep current primary-color background cue.
  - Add outline using layer outline color.
- [ ] Replace free-form control wall with grouped UI sections:
  - `Type`
  - `Position` (including size)
  - `Appearance` (color, glow, shadow)
  - `Mode` / `Layer-Specific`

## P1 - Spectrogram Improvements

- [ ] Make `Low Cut` / `High Cut` affect displayed spectrum range, not only analyzer response.
- [ ] Add circular-mode `Cutout` property (inner radius/opening size).
- [ ] Add mode-specific response scaling controls without changing object dimensions:
  - Bar mode: bar height multiplier
  - Line mode: line height multiplier
  - Dots mode: dot size/intensity multiplier

## P2 - Layer Rendering Quality

- [ ] Image-layer outline should follow non-transparent pixels, not full image bounds.
  - Current behavior outlines full rectangle.
  - Candidate approach: alpha-aware edge extraction or glow-as-outline mode.

## P2 - Layout / Workspace Enhancements

- [ ] Add Preview workspace modes:
  - `Snap Right` (preview docked alongside section stack)
  - `Pop Out` (secondary window preview)
- [ ] Add slight transparency to trial lock banner to hint locked controls underneath.

---

## Suggested Execution Order

1. P0 regressions (preview restore, glow/shadow separation, mirror semantics, lock coverage).
2. Timeline editing model (hover handles + ALT trim mode + visual trim shading).
3. Layer panel move + grouping + duplicate-selection polish.
4. Spectrogram feature upgrades.
5. Preview workspace modes and visual polish.
