"use strict";

window.YUE2Notation = {
  prepare(abc) {
    // abcjs counts a compressed multi-bar rest as one visual bar when wrapping
    // voices. Expand only parsed rest tokens so simultaneous parts stay aligned.
    const tune = ABCJS.parseOnly(abc)[0];
    const replacements = new Map();
    for (const line of tune?.lines || []) {
      for (const staff of line.staff || []) {
        for (const voice of staff.voices) {
          for (const note of voice) {
            const count = note.rest?.text;
            if (note.rest?.type !== "multimeasure" || !Number.isSafeInteger(count) || count <= 1) continue;
            const text = abc.slice(note.startChar, note.endChar);
            const token = /Z\d+(?=\s*$)/.exec(text);
            if (!token || Number(token[0].slice(1)) !== count) throw new Error("Cannot locate score rest");
            replacements.set(note.startChar + token.index, {
              length: token[0].length, text: Array(count).fill("Z").join("|"),
            });
          }
        }
      }
    }
    for (const [start, replacement] of [...replacements].sort((a, b) => b[0] - a[0])) {
      abc = abc.slice(0, start) + replacement.text + abc.slice(start + replacement.length);
    }
    // Keep synthesis on the original tune. Extra barlines can otherwise change
    // abcjs's automatically generated chord accompaniment in a few scores.
    return { abc, setUpAudio: tune ? options => tune.setUpAudio(options) : null };
  },

  highlighter(scoreNode) {
    let highlighted = [];
    let lastSystem = null;
    return event => {
      highlighted.forEach(node => node.classList.remove("playing-note"));
      highlighted = (event?.elements || []).flat().filter(Boolean);
      highlighted.forEach(node => node.classList.add("playing-note"));
      if (!event) { lastSystem = null; return; }
      const target = highlighted[0];
      const frame = scoreNode.parentElement;
      if (!target || !scoreNode.isConnected || !frame.clientHeight) return;
      const matrix = target.ownerSVGElement?.getScreenCTM();
      if (!matrix || !Number.isFinite(event.top) || !Number.isFinite(event.height)) return;
      // Follow the whole staff system, once per line. Its coordinates are in
      // SVG units, so use the rendered scale rather than individual note bounds.
      if (event.top === lastSystem) return;
      lastSystem = event.top;
      const top = matrix.d * event.top + matrix.f;
      const bottom = top + matrix.d * event.height;
      const viewport = frame.getBoundingClientRect();
      if (top < viewport.top + 20 || bottom > viewport.top + frame.clientHeight - 20) {
        frame.scrollTop += top - viewport.top - 30;
      }
    };
  },
};
