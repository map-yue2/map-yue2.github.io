"use strict";

// The conversation is chronological. Audio uses the site's shared transport.
window.YUE2AgenticEditing = (() => {
  function mount({ root, data, element, button, audioPlayer, copyText, deferredScore, disposeController }) {
    const rows = new Map(data.steps.flatMap(step => step.versions.map(row => [row.id, row])));
    const views = new Map();
    const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
    const link = (text, href, className = "") => {
      const node = element("a", className, text);
      node.href = href;
      node.download = "";
      return node;
    };
    const disclosure = (label, className = "") => {
      const node = element("details", `agentic-detail ${className}`);
      node.append(element("summary", "", label));
      return node;
    };
    function diff(parts, separator) {
      const node = element("div", "agentic-diff");
      for (const part of parts) {
        if (node.childNodes.length) node.append(separator);
        if (part.kind === "equal") node.append(part.after);
        else {
          if (part.before) node.append(element("del", "", part.before));
          if (part.before && part.after) node.append(separator);
          if (part.after) node.append(element("ins", "", part.after));
        }
      }
      return node;
    }
    function inputDetail(row, kind) {
      const lyrics = kind === "lyrics";
      const value = lyrics ? row.lyrics : row.style;
      const title = lyrics ? "Lyrics & changes" : "Style prompt & changes";
      const details = disclosure(title, `agentic-${kind}`);
      details.dataset.view = kind;
      const body = element("div", "agentic-detail-body");
      const heading = element("h6", "agentic-input-label", lyrics ? `Lyrics used · ${row.language}` : "Style prompt used");
      heading.tabIndex = -1;
      const text = element("pre", "agentic-input", value);
      text.lang = lyrics && row.language === "Mandarin" ? "zh-Hans" : "en";
      body.append(heading, text, button(lyrics ? "Copy lyrics" : "Copy style prompt", "ghost-button", () => copyText(value)));
      if (lyrics && row.lyricsTranslation) {
        const translation = disclosure("English reading translation", "agentic-translation");
        translation.append(element("p", "agentic-small", "For reading; the lyrics used in this version are the Mandarin text above."),
          element("pre", "agentic-input", row.lyricsTranslation));
        body.append(translation);
      }
      const before = rows.get(row.previous);
      if (before) {
        const unchanged = value === (lyrics ? before.lyrics : before.style);
        const note = element("p", "agentic-small", `${unchanged ? "Unchanged from" : "Compared with"} ${before.label.toLowerCase()}.`);
        body.append(note);
        if (!unchanged) {
          const changes = disclosure("Compare exact text", "agentic-comparison");
          const legend = element("p", "agentic-diff-key");
          legend.append(element("span", "", "− Removed"), element("span", "", "+ Added"));
          const edits = diff(lyrics ? row.lyricEdits : row.styleEdits, lyrics ? "\n" : ", ");
          if (lyrics && (before.language === "Mandarin" || row.language === "Mandarin")) edits.lang = "mul";
          changes.append(legend, edits);
          body.append(changes);
        }
      }
      details.append(body);
      return { details, heading, text };
    }
    function versionPanel(row, stepNumber) {
      const panel = element("article", "agentic-version");
      panel.dataset.trackId = `agentic:${row.id}`;
      panel.id = `edit-${row.id}`;
      const head = element("div", "agentic-version-heading");
      const title = element("h5", "", row.label);
      const playing = element("span", "now-playing-label", "Now playing");
      playing.hidden = true;
      head.append(title, playing);
      const meta = element("p", "agentic-meta", `${row.language} · ${row.bpm} BPM in the score · ${duration(row.duration)} full song`);
      panel.append(head, meta, element("p", "agentic-version-note", row.note));
      const audio = audioPlayer(row.audio, `The Last Train — step ${stepNumber}, ${row.label}`, "agentic");
      panel.append(audio);
      const changes = element("dl", "agentic-changes");
      for (const [label, text] of [["Style", row.styleChange], ["Lyrics", row.lyricsChange]]) {
        const pair = element("div");
        pair.append(element("dt", "", label), element("dd", "", text));
        changes.append(pair);
      }
      panel.append(changes);
      const tools = element("div", "agentic-tools");
      const score = disclosure("Score · view & play", "agentic-score");
      score.dataset.view = "score";
      const scoreBody = element("div", "agentic-detail-body");
      scoreBody.append(element("p", "agentic-small", "Piano playback of the written score. Use the full-song player above to hear the generated performance."));
      const controls = element("div", "cover-controls");
      const frame = element("div", "cover-score agentic-score-frame");
      const engraving = element("div", "cover-score-inner");
      frame.append(engraving);
      frame.tabIndex = 0;
      frame.setAttribute("role", "region");
      frame.setAttribute("aria-label", `${row.label}: scrollable musical score`);
      const raw = disclosure("ABC notation", "agentic-raw");
      raw.append(element("pre", "cover-abc", row.abc));
      const actions = element("div", "agentic-downloads");
      actions.append(link("Download ABC", row.abcUrl), button("Copy ABC", "ghost-button", () => copyText(row.abc)), link("Download full song", row.audio));
      scoreBody.append(controls, frame, actions, raw);
      score.append(scoreBody);
      let controller = null;
      let cancelScore = () => {};
      function disposeScore() {
        cancelScore();
        cancelScore = () => {};
        disposeController(controller);
        controller = null;
        engraving.replaceChildren();
        controls.replaceChildren();
      }
      score.addEventListener("toggle", () => {
        disposeScore();
        if (score.open && !panel.hidden && panel.closest(".agentic-step").open) {
          cancelScore = deferredScore(row.abc, engraving, controls, result => { controller = result; }, () => {
            controls.replaceChildren();
            engraving.replaceChildren(element("p", "notice", "The score player could not load. Close and reopen it to retry, or download the ABC below."));
          });
        }
      });
      const style = inputDetail(row, "style");
      const lyrics = inputDetail(row, "lyrics");
      tools.append(score, style.details, lyrics.details);
      panel.append(tools);
      return { panel, title, score, lyrics, audio,
        closeScore: () => { score.open = false; disposeScore(); } };
    }

    const intro = element("div", "agentic-intro");
    intro.append(element("p", "agentic-kicker", "ONE SONG · 9 STEPS · 14 VERSIONS"), element("h4", "agentic-song-title", data.title),
      element("p", "agentic-deck", "An acoustic pop song becomes modern vocal jazz through a conversation: change the harmony, reshape the melody, develop a familiar theme, then rewrite the words."));
    const path = element("p", "agentic-path", "Acoustic pop → Swing trio → Saxophone interlude → Modern jazz");
    const jump = element("a", "agentic-jump", "Jump to the final English version ↗");
    jump.href = `#edit-${data.final}`;
    jump.addEventListener("click", event => {
      event.preventDefault();
      const destination = reveal(data.final);
      history.replaceState(null, "", jump.hash);
      destination.focus.tabIndex = -1;
      destination.focus.focus({ preventScroll: true });
      destination.target.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
    intro.append(path, jump, element("p", "agentic-editor-note", "Condensed and translated into English from an editing conversation. Related requests are grouped; comparison renders and refinement passes stay with the request that prompted them. Expand a step to hear every version and inspect its score and inputs."));
    const timeline = element("div", "agentic-timeline");
    for (const [index, step] of data.steps.entries()) {
      const container = element("details", "agentic-step");
      container.id = `editing-step-${step.id}`;
      container.open = index === 0;
      const summary = element("summary", "agentic-step-heading");
      const number = element("span", "agentic-step-number", String(index + 1).padStart(2, "0"));
      const text = element("span", "agentic-step-title");
      text.append(element("span", "agentic-step-phase", step.phase), element("span", "agentic-step-name", step.title));
      summary.append(number, text, element("span", "agentic-step-count", `${step.versions.length} ${step.versions.length === 1 ? "version" : "versions"}`), element("span", "agentic-chevron", "+"));
      container.append(summary);
      const content = element("div", "agentic-step-body");
      if (step.context) content.append(element("p", "agentic-context", step.context));
      const user = element("div", "agentic-message agentic-user");
      user.append(element("p", "agentic-speaker", "User"), element("blockquote", "", step.user));
      const agent = element("div", "agentic-message agentic-agent");
      agent.append(element("p", "agentic-speaker", "Agent"), element("p", "", step.agent));
      content.append(user, agent);
      const cue = element("p", "agentic-listen-for");
      cue.append(element("strong", "", "Listen for "), step.listenFor);
      content.append(cue);
      const picker = element("label", "agentic-version-picker");
      const select = element("select");
      select.setAttribute("aria-label", `Step ${index + 1}: choose a version`);
      const panels = new Map();
      for (const row of step.versions) {
        const option = element("option", "", row.label);
        option.value = row.id;
        select.append(option);
        panels.set(row.id, versionPanel(row, index + 1));
      }
      const choose = id => {
        for (const [key, view] of panels) {
          if (key !== id) view.closeScore();
          view.panel.hidden = key !== id;
        }
        select.value = id;
      };
      select.addEventListener("change", () => choose(select.value));
      picker.append(element("span", "", "Versions from this request"), select);
      if (step.versions.length > 1) content.append(picker);
      for (const [id, view] of panels) {
        content.append(view.panel);
        views.set(id, { ...view, choose, step: container });
      }
      choose(step.primary);
      container.addEventListener("toggle", () => {
        if (!container.open) for (const view of panels.values()) view.closeScore();
      });
      container.append(content);
      timeline.append(container);
    }
    function reveal(id, view = "song") {
      const entry = views.get(id);
      if (!entry) return {};
      entry.step.open = true;
      entry.choose(id);
      if (view === "score") {
        entry.score.open = true;
        return { target: entry.score, focus: entry.score.firstElementChild, reader: entry.score };
      }
      if (view === "lyrics") {
        entry.lyrics.details.open = true;
        return { target: entry.lyrics.heading, focus: entry.lyrics.heading, reader: entry.lyrics.text };
      }
      return { target: entry.title, focus: entry.title };
    }
    root.replaceChildren(intro, timeline);
    const followHash = () => {
      const id = location.hash.replace(/^#edit-/, "");
      if (!views.has(id)) return;
      const { target } = reveal(id);
      requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    };
    window.addEventListener("hashchange", followHash);
    if (location.hash.startsWith("#edit-")) followHash();
    return { reveal };
  }
  return { mount };
})();
