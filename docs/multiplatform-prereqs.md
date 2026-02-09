# Multiplatform Release Prerequisites

Date: February 7, 2026
Project: `vizmatic` (current desktop app is Electron + Python renderer)

## Goal

Prepare the organization and tooling to ship and test:
- macOS desktop releases
- iOS releases
- Android releases

This document is a pre-implementation checklist so platform work can start without account/tooling blockers.

## Current Reality

- Current scripted packaging is Windows-only (`npm run package:win`).
- Installer flow is Windows Inno Setup only.
- Rendering depends on a Python subprocess + ffmpeg/ffprobe binaries.
- iOS/Android are not direct Electron targets; mobile requires a platform port.

## Decision Gates (Before Any Build Work)

- Confirm product scope:
  - `A)` macOS only (desktop expansion)
  - `B)` macOS + mobile companion
  - `C)` full mobile parity with desktop
- Confirm rendering architecture for mobile:
  - `A)` on-device native ffmpeg
  - `B)` cloud/server rendering
  - `C)` hybrid fallback
- Confirm release owner roles:
  - Apple account owner
  - Google Play account owner
  - CI/CD owner
  - QA release manager

## Shared Prerequisites (All Platforms)

### Accounts and Access

- Git hosting admin access for protected release branches.
- CI provider with macOS runners available.
- Password manager/vault for release secrets.
- Team distribution channels:
  - Internal beta list
  - External beta list (if applicable)

### Versioning and Release Policy

- Define semantic versioning policy (`major.minor.patch`).
- Define build number policy per platform.
- Define release channel policy:
  - dev
  - beta
  - production
- Define rollback policy with artifact retention.

### Security and Signing Material Handling

- Store signing keys/certs only in secure vault/CI secrets.
- Define who can rotate/revoke certificates.
- Document lost-key incident process.
- Enforce 2FA on all store and signing accounts.

## macOS Prerequisites (Electron Desktop)

### Apple Program and Identity

- Apple Developer Program membership (Organization preferred).
- App identifier strategy (`bundle id`) finalized.
- Team ID documented.
- Developer ID Application certificate available.
- Developer ID Installer certificate available (if using installer package).

### Mac Build Environment

- At least one Apple Silicon Mac build machine.
- Xcode + Command Line Tools installed.
- Node/npm versions pinned and documented.
- Python runtime/version pinned for renderer build.
- ffmpeg/ffprobe mac binaries selected and license reviewed.

### Signing and Notarization Setup

- Apple notarization credentials prepared for CI:
  - App Store Connect API key (recommended) or app-specific password workflow.
- Entitlements/plist requirements defined (file access, hardened runtime).
- Notarization + stapling validation command sequence documented.

### Packaging and Distribution Plan

- Packaging format decided (`.dmg`, `.zip`, or both).
- Install/update strategy chosen:
  - manual install
  - auto-update (if adopted later)
- Artifact naming standard defined:
  - `vizmatic-mac-<version>-<arch>.<ext>`

### macOS QA Baseline

- Test matrix includes:
  - Apple Silicon (required)
  - Intel (if supported)
  - Latest macOS + previous major version
- Smoke checks:
  - app launch
  - open/save project
  - render success
  - render cancel
  - permissions prompts behavior

## iOS Prerequisites

## Strategic Note

iOS requires a mobile app implementation path. Electron desktop code cannot be shipped directly to iOS.

### Apple Mobile Account Setup

- Apple Developer Program active with mobile app permissions.
- App Store Connect app record created.
- Bundle ID reserved for iOS app.
- Distribution certificate/profile workflow defined (automatic vs manual signing).

### Product and Compliance

- Privacy policy URL ready.
- App privacy questionnaire inputs prepared (media/file access, analytics, identifiers).
- Export compliance answers prepared (encryption usage).
- Age rating and content rights owner identified.

### Build and Test Infrastructure

- Xcode version pinned for CI/local.
- iOS physical test devices available (at minimum:
  - one recent iPhone
  - one older supported iPhone)
- TestFlight internal group and external tester plan defined.

### iOS Release Operations

- Build number increment strategy defined.
- Screenshot/device-size capture process defined.
- App Store metadata owner assigned (title, subtitle, keywords, support URL).
- Crash reporting/monitoring tool selected.

## Android Prerequisites

## Strategic Note

Android also requires a mobile app implementation path and replacement of Electron-specific runtime APIs.

### Google Play Account and Identity

- Google Play Console Organization account active.
- App package name finalized (`applicationId`).
- App signing key strategy finalized:
  - Play App Signing enabled
  - upload key generated and safely backed up

### Android Build Environment

- Android Studio + SDK/NDK versions pinned.
- JDK version pinned.
- CI Android runner configured for reproducible builds.

### Store and Compliance

- Data Safety form inputs prepared.
- Content rating questionnaire owner assigned.
- Privacy policy URL ready.
- Target API compliance tracked (annual Play requirements).

### Android Testing and Rollout

- Internal testing track configured.
- Closed testing track plan defined (if needed).
- Device matrix includes:
  - modern flagship
  - mid-tier Android
  - lower-RAM device
- AAB artifact standard defined:
  - `vizmatic-android-<version>-<build>.aab`

## CI/CD Prerequisites and Secrets

### CI Pipelines to Prepare

- `build-mac` (unsigned smoke build)
- `release-mac` (signed + notarized)
- `build-ios` (archive + TestFlight upload)
- `build-android` (AAB + internal track upload)

### Secrets Inventory

- Apple:
  - App Store Connect API key (`issuer id`, `key id`, private key)
  - signing certificate material (if not managed fully by CI keychain tooling)
- Android:
  - upload keystore file
  - keystore password
  - key alias + key password
  - Play Console service account JSON (if automated upload)
- General:
  - crash reporting DSN/token
  - release webhook tokens (Slack/Teams/etc.)

### Release Observability

- Crash reporting enabled for each platform before public launch.
- Release health dashboard with:
  - install success rate
  - crash-free sessions
  - render failure rate

## Renderer-Specific Prereqs (Critical)

- Decide per-platform renderer strategy and document it before implementation.
- If local ffmpeg rendering is kept:
  - source trusted ffmpeg binaries per platform
  - verify codec support
  - verify license obligations for bundled binaries
- Define fallback behavior when rendering is unsupported on a device.

## Recommended Execution Order

1. Finalize scope and mobile renderer architecture decision.
2. Set up Apple/Google accounts and store records.
3. Set up CI secrets and macOS build runner.
4. Implement and validate macOS desktop release lane first.
5. Run iOS and Android proof-of-concept spikes for rendering feasibility.
6. Commit to full mobile implementation only after POC passes critical media/render tests.

## Definition of "Ready to Start Implementation"

Start platform engineering only when all are true:

- Scope and architecture decisions are signed off.
- Required accounts are active and accessible by release owners.
- Signing keys/certificates are created and stored securely.
- CI secrets are provisioned and validated with dry-run pipelines.
- QA device matrix and test owners are assigned.
- Release metadata/compliance owners are assigned for Apple and Google stores.
