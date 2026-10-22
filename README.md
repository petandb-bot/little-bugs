# LITTLE BUGS — v0.2

A pocket-sized experimental voice toy. Record any sound and hatch it into a strange, repeating loop. Everything runs locally in your browser.

## Play

1. Tap **REC** and allow microphone access.
2. Tap **STOP** when finished (12 seconds maximum).
3. Tap **HATCH** to generate a new sound creature.
4. Tap **PLAY** to start or stop the repeating loop.
5. Tap **SAVE** to export a stereo WAV file.

Tap **HATCH** again to create a different loop from the same recording.

## Publish with GitHub Pages

1. Create a GitHub repository.
2. Upload the **contents** of this folder to the repository root. Keep `index.html` at the top level.
3. Open **Settings → Pages**.
4. Set **Source** to **Deploy from a branch**, **Branch** to `main`, and **Folder** to `/(root)`. Save.
5. Open the website URL displayed in Pages settings.

On iPhone, open the site in Safari and choose **Share → Add to Home Screen**.

## Notes

- Use HTTPS or localhost for microphone access.
- No account, backend, or audio uploads are required.
- The saved WAV contains two variations of one repeating cycle.
- Offline use becomes available after the site and its dependencies have been loaded once.
- A real microphone and mobile-browser test is recommended before sharing the app.
