"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const data = window.YUE2_DATA;
  if (!data || !Array.isArray(data.cases) || !Array.isArray(data.covers)) {
    $("selectedTitle").textContent = "The collection could not be loaded. Please refresh the page.";
    return;
  }
  const planned = data.cases.filter(item => item.mode === "planned");
  const controllers = new Set();
  let selectedId = null;
  let mainController = null;
  let explorerLimit = 12;
  let toastTimer;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function notify(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").classList.add("visible");
    toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 3200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard");
    } catch {
      notify("Copy is unavailable. Select the text and copy it manually.");
    }
  }

  function button(label, className, callback) {
    const node = element("button", className, label);
    node.type = "button";
    node.addEventListener("click", callback);
    return node;
  }

  function stopOtherAudio(except) {
    document.querySelectorAll("audio").forEach(audio => {
      if (audio !== except && !audio.paused) audio.pause();
    });
    controllers.forEach(controller => {
      if (controller !== except && controller.isStarted) {
        controller.pause();
        controller.isStarted = false;
      }
    });
  }

  document.addEventListener("play", event => {
    if (event.target.tagName === "AUDIO") stopOtherAudio(event.target);
  }, true);

  function audioPlayer(url, label) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = url;
    audio.setAttribute("aria-label", label);
    return audio;
  }

  document.addEventListener("error", event => {
    if (event.target.tagName === "AUDIO") notify("This audio could not be loaded. Please try again.");
  }, true);

  function disposeController(controller) {
    if (!controller) return;
    controller.disposed = true;
    controller.pause();
    controller.isStarted = false;
    if (!controller.isLoading) controller.destroy();
    controllers.delete(controller);
  }

  function createScore(abc, scoreNode, controlsNode) {
    if (!window.ABCJS) throw new Error("Score renderer unavailable");
    const visual = ABCJS.renderAbc(scoreNode, abc, {
      responsive: "resize", add_classes: true, staffwidth: 820,
      paddingtop: 15, paddingbottom: 20,
      wrap: { minSpacing: 1.4, maxSpacing: 2.5, preferredMeasuresPerLine: 4 },
    })[0];
    if (!visual) throw new Error("The score could not be rendered");
    if (!ABCJS.synth || !ABCJS.synth.supportsAudio()) {
      controlsNode.replaceChildren(element("p", "notice", "Interactive playback is not supported in this browser. Use the original score recording."));
      return null;
    }
    let highlighted = [];
    const clearHighlight = () => {
      highlighted.forEach(node => node.classList.remove("playing-note"));
      highlighted = [];
    };
    const controller = new ABCJS.synth.SynthController();
    controllers.add(controller);
    controller.load(controlsNode, {
      onStart: () => stopOtherAudio(controller),
      onFinished: clearHighlight,
      onEvent: event => {
        clearHighlight();
        if (!event || !event.elements) return;
        highlighted = event.elements.flat().filter(Boolean);
        highlighted.forEach(node => node.classList.add("playing-note"));
        const target = highlighted[0];
        const frame = scoreNode.parentElement;
        if (target && !controller.disposed) {
          const bounds = target.getBoundingClientRect();
          const viewport = frame.getBoundingClientRect();
          if (bounds.top < viewport.top + 20 || bounds.bottom > viewport.bottom - 30) {
            frame.scrollTop += bounds.top - viewport.top - 70;
          }
        }
      },
    }, { displayRestart: true, displayPlay: true, displayProgress: true, displayLoop: true, displayWarp: false });
    // Avoid an old, asynchronously loading tune starting after the selection changes.
    const originalPlay = controller._play.bind(controller);
    controller._play = () => controller.disposed ? Promise.resolve() : originalPlay();
    const originalGo = controller.go.bind(controller);
    controller.go = async () => {
      try {
        const result = await originalGo();
        if (controller.disposed) controller.destroy();
        return result;
      } catch (error) {
        controller.isLoading = false;
        if (!controller.disposed) {
          notify("Interactive score playback could not load. The original score recording is available below.");
        }
        throw error;
      }
    };
    controller.setTune(visual, false, {});
    return controller;
  }

  function fillSelect(node, items, allLabel) {
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = allLabel;
    const options = items.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    });
    node.replaceChildren(all, ...options);
  }

  function optionsFor(rows, key, labelKey = key) {
    const values = new Map(rows.map(row => [row[key], row[labelKey]]));
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }

  function matches(row, query, language, genre, mode = "all") {
    if (language !== "all" && row.language !== language) return false;
    if (genre !== "all" && row.genre !== genre) return false;
    if (mode !== "all" && row.mode !== mode) return false;
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const searchable = `${row.title} ${row.genrePath.join(" ")} ${row.languageLabel} ${row.tags} ${row.lyrics}`.toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  }

  function selectTab(name) {
    document.querySelectorAll(".tabs .tab").forEach(tab => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      const panel = $(tab.getAttribute("aria-controls"));
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  }

  document.querySelectorAll(".tabs .tab").forEach(tab => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    tab.addEventListener("keydown", event => {
      const tabs = [...document.querySelectorAll(".tabs .tab")];
      const index = tabs.indexOf(tab);
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        selectTab(tabs[next].dataset.tab);
        tabs[next].focus();
      }
    });
  });

  function summaryChips(row) {
    const header = name => (row.abc.match(new RegExp(`^${name}:\\s*(.*)$`, "m")) || [])[1];
    const tempo = header("Q");
    const bpm = tempo && (tempo.match(/=\s*(\d+(?:\.\d+)?)/) || tempo.match(/^(\d+(?:\.\d+)?)$/));
    const pairs = [["Language", row.languageLabel], ["Key", header("K")], ["Meter", header("M")], ["Tempo", bpm ? `${bpm[1]} BPM` : tempo]];
    $("abcPlanSummary").replaceChildren(...pairs.filter(([, value]) => value).map(([name, value]) => {
      const chip = element("span", "plan-chip");
      chip.append(element("b", "", name), document.createTextNode(value));
      return chip;
    }));
  }

  function showOriginalPages(row) {
    $("originalScorePages").replaceChildren(...row.sheets.map((url, index) => {
      const image = document.createElement("img");
      image.src = url;
      image.alt = `${row.title}, score page ${index + 1}`;
      image.loading = "lazy";
      image.decoding = "async";
      return image;
    }));
  }

  $("originalScoreDetails").addEventListener("toggle", () => {
    if ($("originalScoreDetails").open && !$("originalScorePages").children.length) {
      const row = planned.find(item => item.id === selectedId);
      if (row) showOriginalPages(row);
    }
  });

  function selectCase(id, shouldScroll = false) {
    const row = planned.find(item => item.id === id);
    if (!row) return;
    document.querySelector(".case-stage").hidden = false;
    disposeController(mainController);
    mainController = null;
    $("musicAudio").pause();
    $("recordedScore").pause();
    selectedId = id;
    $("selectedKicker").textContent = `${row.languageLabel} · Symbolic planning`;
    $("selectedTitle").textContent = row.title;
    $("musicAudio").src = row.audio;
    $("musicAudio").setAttribute("aria-label", `${row.title} generated song`);
    $("recordedScore").src = row.scoreAudio;
    $("abcText").textContent = row.abc;
    $("lyricsText").textContent = row.lyrics;
    $("promptText").textContent = row.tags;
    $("copyAbc").onclick = () => copyText(row.abc);
    $("originalScoreDetails").open = false;
    $("originalScorePages").replaceChildren();
    $("abcRenderedScore").replaceChildren();
    $("abcSynth").replaceChildren();
    $("sheetFrame").scrollTop = 0;
    summaryChips(row);
    selectTab("score");
    try {
      mainController = createScore(row.abc, $("abcRenderedScore"), $("abcSynth"));
    } catch (error) {
      $("abcRenderedScore").replaceChildren(element("p", "notice", "The interactive score could not be rendered. Original score pages are available below."));
      $("abcSynth").replaceChildren(element("p", "notice", "Use the original score recording below."));
      $("originalScoreDetails").open = true;
      showOriginalPages(row);
    }
    document.querySelectorAll(".case-item").forEach(node => {
      const active = node.dataset.id === id;
      node.classList.toggle("selected", active);
      node.setAttribute("aria-pressed", String(active));
    });
    if (shouldScroll) $("abc-cot-gen").scrollIntoView({ block: "start" });
  }

  function renderRail() {
    const rows = planned.filter(row => matches(row, $("searchInput").value, $("languageFilter").value, $("genreFilter").value));
    const sort = $("sortSelect").value;
    if (sort === "genre") rows.sort((a, b) => a.genre.localeCompare(b.genre) || a.order - b.order);
    if (sort === "language") rows.sort((a, b) => a.languageLabel.localeCompare(b.languageLabel) || a.order - b.order);
    if (sort === "pages") rows.sort((a, b) => b.sheets.length - a.sheets.length || a.order - b.order);
    $("caseRail").replaceChildren(...rows.map((row, index) => {
      const item = button("", "case-item", () => selectCase(row.id));
      item.dataset.id = row.id;
      item.setAttribute("aria-pressed", String(row.id === selectedId));
      item.classList.toggle("selected", row.id === selectedId);
      const copy = element("span", "case-item-copy");
      copy.append(element("strong", "", row.title), element("small", "", `${row.languageLabel} · ${row.sheets.length} score pages`));
      item.append(element("span", "case-number", String(index + 1).padStart(2, "0")), copy);
      return item;
    }));
    if (!rows.length) {
      $("caseRail").append(element("p", "empty-state", "No scores match these filters."));
      document.querySelector(".case-stage").hidden = true;
    } else {
      document.querySelector(".case-stage").hidden = false;
      if (!rows.some(row => row.id === selectedId)) selectCase(rows[0].id);
    }
  }

  function openScore(id) {
    $("searchInput").value = "";
    $("languageFilter").value = "all";
    $("genreFilter").value = "all";
    renderRail();
    selectCase(id, true);
  }

  function textDetails(tags, lyrics) {
    const details = element("details", "content-details");
    details.append(element("summary", "", "Prompt & lyrics"));
    const body = element("div", "detail-body");
    body.append(element("h4", "", "Style prompt"), element("pre", "", tags), element("h4", "", "Lyrics"), element("pre", "", lyrics));
    body.append(button("Copy prompt & lyrics", "ghost-button", () => copyText(`${tags}\n\n${lyrics}`)));
    details.append(body);
    return details;
  }

  function coverCard(row, index) {
    const card = element("article", "cover-card");
    card.id = `cover-${row.id}`;
    const header = element("header");
    const title = element("div");
    title.append(element("h3", "", row.title), element("p", "source-label", row.source));
    header.append(element("span", "track-number", String(index + 1).padStart(2, "0")), title);
    card.append(header, element("span", "style-badge", row.genre), element("p", "edit-label", row.editType), audioPlayer(row.audio, `${row.title}, generated cover`));
    card.append(textDetails(row.tags, row.lyrics));
    const details = element("details", "content-details");
    details.append(element("summary", "", "ABC score & playback"));
    const controls = element("div", "cover-controls");
    const frame = element("div", "cover-score");
    const score = element("div", "cover-score-inner");
    frame.append(score);
    const raw = element("details", "detail-body");
    raw.append(element("summary", "", "Raw ABC"), element("pre", "cover-abc", row.abc));
    details.append(controls, frame, raw, button("Copy ABC", "ghost-button", () => copyText(row.abc)));
    let controller = null;
    details.addEventListener("toggle", () => {
      if (details.open) {
        try { controller = createScore(row.abc, score, controls); }
        catch { score.replaceChildren(element("p", "notice", "Interactive score unavailable. The original ABC is included below.")); }
      } else {
        disposeController(controller);
        controller = null;
        score.replaceChildren();
        controls.replaceChildren();
      }
    });
    card.append(details);
    return card;
  }

  function explorerCard(row) {
    const card = element("article", "explorer-card");
    card.id = `song-${row.id}`;
    const header = element("header");
    header.append(element("h3", "", row.title));
    const badges = element("div", "badge-row");
    badges.append(element("span", "badge", row.languageLabel), element("span", "badge", row.mode === "planned" ? "Symbolic planning" : "Direct generation"));
    header.append(badges);
    card.append(header, element("p", "tag-excerpt", row.tags), audioPlayer(row.audio, `${row.title}, ${row.languageLabel}, generated song`));
    if (row.mode === "planned") card.append(button("View the ABC score ↗", "text-link", () => openScore(row.id)));
    card.append(textDetails(row.tags, row.lyrics));
    return card;
  }

  function explorerMatches() {
    return data.cases.filter(row => matches(row, $("explorerSearch").value, $("explorerLanguage").value, $("explorerGenre").value, $("explorerMode").value));
  }

  function renderExplorer(append = false) {
    const rows = explorerMatches();
    const start = append ? $("explorerGrid").children.length : 0;
    if (!append) $("explorerGrid").replaceChildren();
    $("explorerGrid").append(...rows.slice(start, explorerLimit).map(explorerCard));
    $("explorerStatus").textContent = rows.length ? `Showing ${Math.min(explorerLimit, rows.length)} of ${rows.length} selected songs` : "No songs match these filters.";
    $("loadMore").hidden = explorerLimit >= rows.length;
  }

  const summary = data.summary;
  const facts = [[summary.genreCount, "selected songs"], [summary.genres, "genres"], [summary.languages, "languages"], [summary.coverCount, "covers"]];
  $("collectionSummary").replaceChildren(...facts.map(([count, label]) => {
    const fact = element("span", "fact");
    fact.append(element("strong", "", count), document.createTextNode(` ${label}`));
    return fact;
  }));
  $("plannedCount").textContent = `${summary.plannedCount} selected scores`;
  $("coverCount").textContent = `${summary.coverCount} selected covers`;
  $("genreCount").textContent = `${summary.genreCount} selected songs`;
  $("caseSummary").textContent = `${planned.length} cases`;
  $("genreDescription").textContent = `${summary.genreCount} songs selected by listening: ${summary.plannedCount} with symbolic planning and ${summary.directCount} generated directly from lyrics and tags.`;
  fillSelect($("languageFilter"), optionsFor(planned, "language", "languageLabel"), "All languages");
  fillSelect($("genreFilter"), optionsFor(planned, "genre"), "All genres");
  fillSelect($("explorerLanguage"), optionsFor(data.cases, "language", "languageLabel"), "All languages");
  fillSelect($("explorerGenre"), optionsFor(data.cases, "genre"), "All genres");
  $("searchInput").addEventListener("input", renderRail);
  ["languageFilter", "genreFilter", "sortSelect"].forEach(id => $(id).addEventListener("change", renderRail));
  ["explorerSearch", "explorerLanguage", "explorerGenre", "explorerMode"].forEach(id => {
    $(id).addEventListener(id === "explorerSearch" ? "input" : "change", () => {
      explorerLimit = 12;
      renderExplorer();
    });
  });
  $("loadMore").addEventListener("click", () => {
    explorerLimit += 12;
    renderExplorer(true);
  });
  $("caseGrid").replaceChildren(...planned.map(row => {
    const item = button("", "mini-case", () => openScore(row.id));
    item.append(element("strong", "", row.title), element("small", "", row.languageLabel));
    return item;
  }));
  $("coverGrid").replaceChildren(...data.covers.map(coverCard));
  renderRail();
  renderExplorer();
})();
