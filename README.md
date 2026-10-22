# LITTLE BUGS v1.0 — Mutant Motion

A tiny voice-to-music arcade. Record a sound, hatch a strange loop, and meet a pixel creature.

## Play

1. Tap **REC**, speak or sing (up to 12 seconds), then tap **STOP**.
2. Tap **HATCH** to create a new loop. Tap it again for another mutation.
3. Tap **PLAY** to listen. **GROOVE** adds or removes a small synth accompaniment.
4. Tap **SAVE** to export a stereo WAV. Tap the creature to make it jump.

The app uses moving stereo echoes, rhythmic vocal effects, and simple synth melodies. Your recording stays on your device.

## Publish on GitHub Pages

Upload the unzipped files (including `index.html`) to the repository root. Open **Settings → Pages** and select **Deploy from a branch → main → /(root)**. Visit the published HTTPS site. On iPhone, open it in Safari and choose **Add to Home Screen**.

## Check

Run `npm test` with Node.js 22+. Microphone recording and WAV sharing should also be checked on your own device.

This project is independently developed; it does not contain commercial audio plug-ins.
