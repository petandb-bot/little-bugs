# LITTLE BUGS v0.8 — Voice-Linked Groove

A strange 8-bit voice toy. Record a voice and hatch it into a rhythmic loop.

## Play

1. Tap **REC**, speak or sing (up to 12 seconds), then tap **STOP**.
2. Tap **HATCH** to create a loop; repeat to discover new mutations.
3. Tap **PLAY** to loop or stop. Switch **GROOVE** to add or remove small voice-synced sounds.
4. Tap **SAVE** to export a stereo WAV. Tap the bug to make it react.

Audio stays on your device. Five mutation styles cycle automatically.

## Publish on GitHub Pages

Unzip the package. Upload **all files and folders** to the root of your repository's `main` branch. Go to **Settings → Pages → Deploy from a branch → main → /(root)** and save. Open the published HTTPS link; use **Add to Home Screen** on iPhone.

To run audio checks locally: `npm test` (Node.js 22+). The microphone requires HTTPS or localhost. Safari recording and sharing should be verified on the target iPhone.
