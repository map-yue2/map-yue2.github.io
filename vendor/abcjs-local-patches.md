abcjs 6.7.0 retains its upstream MIT license in `abcjs-LICENSE.md`.

Three local audio-loading fixes are applied to `abcjs-basic-min.js`:

- `src/synth/load-note.js`: time out sample requests after 15 seconds.
- `src/synth/load-note.js`: delete a rejected note promise from the cache so a
  later play attempt can fetch it again.
- `src/synth/create-synth.js`: propagate `_loadBatch` errors to the caller so
  a failed load cannot proceed to synthesize an incomplete or silent buffer.

The page supplies the local FluidR3_GM piano URL and the original volume
multiplier (3). See `soundfonts/FluidR3_GM/LICENSE.txt` for sample attribution.
