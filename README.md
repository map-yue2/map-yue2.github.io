# YuE2 · Frontier music, with a plan

[Visit the project website](https://map-yue2.github.io/).

The page brings together a model overview, ABC Planning, Cover & Editing, and Genre Explorer. Its warm ivory and terracotta design uses the original YuE symbol with a matching YuE2 wordmark, readable score controls, and responsive listening cards.

## Performance and architecture

The September 5, 2026 automatic evaluation compares 13 other systems and two YuE2 settings on WildSongBench (192 prompts) and Old98 (98 prompts). YuE2 (best-of-8) has the highest observed seven-dimension SongBench average on both datasets: 6.9632 and 6.9667, respectively. “SOTA” on this page means this specific lead among the evaluated settings under their recorded generation and selection protocols. “Frontier quality” describes competitiveness with the evaluated proprietary systems. Other metrics have different leaders, compute is not matched, and these means do not establish statistical significance or human preference.

The interactive comparison supports seven aggregate metrics, both datasets, the complete 15-setting table, and a [CSV download](data/benchmark-results.csv). All published aggregates retain their source precision; the interface rounds scores to four decimals and PER percentages to two. Bars begin at zero. `data/benchmarks.js` contains only public aggregate columns from the validated evaluation snapshot.

Both YuE2 evaluation settings use melody-and-chord symbolic planning and the verified new VAE. YuE2 selects the lower PER of two candidates. Best-of-8 uses Musicality → Control → PER across eight; SongBench Musicality participates in selection, so its result includes evaluator-based selection. ASR uses the lowest PER from four repeats per candidate. Control weights differ between selected settings for 10/192 WildSongBench and 5/98 Old98 records. Metric definitions and these protocol details are also available in the page's expandable notes.

The architecture overview describes the approximately 3.59B-parameter, 28-layer AR–NAR Mixture-of-Transformers. Causal prediction produces the symbolic score and MERT2 semantic tokens. Bidirectional flow matching generates acoustic latents from the full condition, followed by VAE decoding. Separate normalization, projections, and MLP experts serve the two streams within one backbone. The interactive Create / Cover / Edit diagram explains the score's origin in each operation. SheetSage2 is an external reference-audio analyzer for covering. Editing re-renders the full song; it does not guarantee unchanged waveform regions.

## Listening collection

The September 8, 2026 selection contains 98 songs selected through Genre Explorer's Like button and eight cover and editing examples. Of the 98 songs, 64 include an ABC plan and 34 use direct generation. The collection spans 69 genre labels and six languages. The latest recorded Like state determines inclusion; a later Unlike excludes a record. Cover & Editing combines cover, melody, lyric, tempo, and arrangement examples in one section.

Audio, ABC notation, lyrics, style prompts, and original score pages are included. MP3s are copied without transcoding. Genre Explorer uses the legacy VAE for listening; this is separate from the new-VAE benchmark audio. Decoder metadata was not included with the supplied cover collection, so these files retain their original identity and are not labeled as verified legacy-VAE renders.

Song cards initially contain lightweight play buttons, with no audio resources. Clicking starts a native player. Only one native player is retained: switching tracks unloads the previous source, and returning resumes the saved position. Filtering away the playing card unloads it. Failed or stalled requests offer retry. The score library and engraving are deferred until a score approaches the viewport or its load button is pressed. Search is debounced; prompt and lyric details populate on demand; Genre Explorer expands in groups of 12.

## Assets and hosting

The page is static, published from `main` at `/`. `.nojekyll` disables Jekyll processing. No build or package installation is required.

The [YuE logo](https://github.com/multimodal-art-projection/YuE/tree/main/assets/logo) retains the original vector geometry and attribution, with terracotta color and a transparent outline for this site. The SVG credits vectorization to DJ Woodward-Magar / DJ Stomp and is distributed under [Apache 2.0](static/brand/LICENSE.txt). This adaptation preserves those metadata credits. The icon is also used as the favicon. Space Grotesk is hosted locally under its [SIL Open Font License](vendor/fonts/OFL.txt); the editorial serif and other scripts use system fonts. No external font request is required.

Score rendering and synthesis use [abcjs 6.7.0](https://github.com/paulrosen/abcjs/releases/tag/v6.7.0), vendored under its [MIT license](vendor/abcjs-LICENSE.md). Player styling isolates the small seek-track button from global button sizing and bounds its SVG icons. Interactive synthesis loads the author's default FluidR3 sound samples over HTTPS. The 64 planned cases also provide local original instrumental recordings.

`data/cases.js` contains the public listening presentation. Private source paths, checkpoint identifiers, event logs, per-song evaluation records, and internal audit files are not deployed.
