# YuE2 project website

[Visit the listening page](https://map-yue2.github.io/).

The September 8, 2026 selection contains 98 songs selected through Genre Explorer's Like button and eight covers. Of the 98 songs, 64 include an ABC plan and 34 use direct generation. The selection spans 69 genre labels and six languages. The latest recorded Like state determines inclusion; entries with a subsequent Unlike are excluded.

The site includes source MP3s, ABC notation, lyrics, prompts, and original rendered score pages. Audio is copied without transcoding. Genre Explorer previews use the legacy VAE. Decoder metadata was not included with the supplied cover collection, so those files retain their original identity and are not labeled as verified legacy-VAE renders. This listening selection does not report evaluation scores.

The page is static and publishes from `main` at `/`. `.nojekyll` disables Jekyll processing. No package installation or build step is required. Song cards initially contain lightweight play buttons. Clicking one creates a native audio player and starts that recording. Only one native player is retained: switching tracks unloads the old source, and returning to a track resumes its remembered position. Filtering away the playing card also unloads it. Failed or stalled requests offer a retry action.

The score library and score engraving are deferred until a score approaches the viewport or its load button is pressed. Switching selections cancels pending rendering. Search updates are debounced, prompt and lyric details populate when opened, and Genre Explorer adds cards in groups of 12.

Score rendering and interactive playback use [abcjs 6.7.0](https://github.com/paulrosen/abcjs/releases/tag/v6.7.0), vendored under its [MIT license](vendor/abcjs-LICENSE.md). Interactive synthesis loads the library's default FluidR3 sound samples from the abcjs author's HTTPS site. The 64 planned Genre Explorer cases also include locally hosted original instrumental recordings, which can be played independently of interactive synthesis.

`data/cases.js` contains only the selected public presentation data. Source paths, event logs, experimental metrics, and model identifiers are kept outside the deployed website.
