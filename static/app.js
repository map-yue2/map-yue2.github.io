"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const data = window.YUE2_DATA;
  if (!data || !Array.isArray(data.cases) || !Array.isArray(data.covers)) {
    $("selectedTitle").textContent = "The collection could not be loaded. Please refresh the page.";
    return;
  }
  function randomOrder(rows, key) {
    const result = window.YUE2Shuffle(rows);
    try {
      const previous = sessionStorage.getItem(key);
      if (result.length > 1 && result[0].id === previous) [result[0], result[1]] = [result[1], result[0]];
      if (result.length) sessionStorage.setItem(key, result[0].id);
    } catch { /* Random browsing also works without browser storage. */ }
    return result;
  }
  let cases = randomOrder(data.cases, "yue2-first-song");
  let covers = randomOrder(data.covers, "yue2-first-cover");
  let planned = cases.filter(item => item.mode === "planned");
  // Give the featured score a fresh first choice independently of direct songs.
  const featured = randomOrder(planned, "yue2-first-score");
  if (featured.length) {
    const first = featured[0];
    cases = [first, ...cases.filter(row => row !== first)];
    planned = cases.filter(item => item.mode === "planned");
  }
  const tracks = new Map();
  const audioMetadata = new Map();
  const agenticData = window.YUE2_AGENTIC;
  const agenticRows = agenticData?.steps.flatMap(step => step.versions) || [];
  let agenticStory = null;
  for (const row of agenticRows) {
    const track = { id: `agentic:${row.id}`, rowId: row.id, url: row.audio, kind: "song", context: "agentic",
      title: `${agenticData.title} · ${row.label}`, subtitle: "Agentic music editing",
      planned: false, hasScore: true, hasLyrics: true };
    tracks.set(track.id, track);
    audioMetadata.set(row.audio, track);
  }
  for (const [rows, context, prefix] of [[data.cases, "explorer", "song"], [data.covers, "covers", "cover"]]) {
    for (const row of rows) {
      const track = { id: `${prefix}:${row.id}`, rowId: row.id, url: row.audio, kind: "song", context,
        title: row.titleZh ? `${row.title} · ${row.titleZh}` : row.title,
        subtitle: context === "covers" ? `Cover & Editing · ${row.genre}` : `${row.languageLabel} · ${row.genre}`,
        planned: row.mode === "planned", hasScore: Boolean(row.abc), hasLyrics: Boolean(row.lyrics?.trim()) };
      tracks.set(track.id, track);
      audioMetadata.set(row.audio, track);
      if (row.scoreAudio) audioMetadata.set(row.scoreAudio, { ...track, url: row.scoreAudio, kind: "score", context: "planned" });
    }
  }
  const controllers = new Set();
  const audioPlayers = new window.YUE2Audio(() => stopOtherAudio(null, true), {
    describe: url => audioMetadata.get(url), parking: $("listeningParking"),
  });
  let listening = null;
  let currentTrack = null;
  let currentState = {};
  let readingView = null;
  let revealRequest = 0;
  const searchText = new Map(data.cases.map(row => [row.id,
    `${row.title} ${row.genrePath.join(" ")} ${row.languageLabel} ${row.tags} ${row.lyrics}`.toLocaleLowerCase()]));
  let selectedId = null;
  let mainController = null;
  let cancelMainScore = () => {};
  let scoreLibrary = null;
  let playbackEpoch = 0;
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

  function stopOtherAudio(except, keepNative = false) {
    playbackEpoch += 1;
    if (except) except.playbackEpoch = playbackEpoch;
    if (!keepNative) audioPlayers.stop();
    controllers.forEach(controller => {
      if (controller !== except && controller.isStarted) {
        controller.pause();
        controller.isStarted = false;
      }
    });
  }

  function audioPlayer(url, label, context) {
    return audioPlayers.create(url, label, context);
  }

  function loadScoreLibrary() {
    if (window.ABCJS) return Promise.resolve();
    if (!scoreLibrary) scoreLibrary = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/abcjs-basic-min.js?v=20260908-audio8";
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        scoreLibrary = null;
        reject(new Error("Score renderer unavailable"));
      };
      document.head.append(script);
    });
    return scoreLibrary;
  }

  function deferredScore(abc, scoreNode, controlsNode, onReady, onError, recording) {
    let cancelled = false;
    let started = false;
    let timer;
    let observer;
    const start = () => {
      if (started || cancelled) return;
      started = true;
      observer?.disconnect();
      controlsNode.replaceChildren(element("p", "score-loading", "Loading score player…"));
      // Let the song controls paint before loading and engraving a full score.
      timer = setTimeout(async () => {
        if (cancelled) return;
        try {
          await loadScoreLibrary();
          if (cancelled) return;
          timer = setTimeout(() => {
            if (cancelled) return;
            scoreNode.replaceChildren();
            controlsNode.replaceChildren();
            try { onReady(createScore(abc, scoreNode, controlsNode, recording)); }
            catch (error) { onError(error); }
          }, 0);
        } catch (error) { if (!cancelled) onError(error); }
      }, 0);
    };
    scoreNode.replaceChildren(element("p", "notice", "The score loads when it comes into view."));
    controlsNode.replaceChildren(button("Load score player", "ghost-button", start));
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) start();
      }, { rootMargin: "100px" });
      observer.observe(scoreNode);
    } else start();
    return () => { cancelled = true; clearTimeout(timer); observer?.disconnect(); };
  }

  function debounce(callback, delay = 150) {
    let timer;
    return () => { clearTimeout(timer); timer = setTimeout(callback, delay); };
  }

  function disposeController(controller) {
    if (!controller) return;
    controller.disposed = true;
    controller.pause();
    controller.isStarted = false;
    if (!controller.isLoading) controller.destroy();
    controllers.delete(controller);
  }

  function createScore(abc, scoreNode, controlsNode, recording) {
    if (!window.ABCJS) throw new Error("Score renderer unavailable");
    const notation = window.YUE2Notation.prepare(abc);
    const visual = ABCJS.renderAbc(scoreNode, notation.abc, {
      responsive: "resize", add_classes: true, staffwidth: 820,
      paddingtop: 15, paddingbottom: 20,
      wrap: { minSpacing: 1.4, maxSpacing: 2.5, preferredMeasuresPerLine: 4 },
    })[0];
    if (!visual) throw new Error("The score could not be rendered");
    if (notation.setUpAudio) visual.setUpAudio = notation.setUpAudio;
    const highlight = window.YUE2Notation.highlighter(scoreNode);
    const clearHighlight = () => highlight(null);
    if (recording) {
      return new window.YUE2ScorePlayer({
        visual, recording, controls: controlsNode, onEvent: highlight,
        revealRecording: () => { controlsNode.parentElement.querySelector(".recorded-score").open = true; },
      });
    }
    if (!ABCJS.synth || !ABCJS.synth.supportsAudio()) {
      controlsNode.replaceChildren(element("p", "notice", "Interactive playback is not supported in this browser."));
      return null;
    }
    const controller = new ABCJS.synth.SynthController();
    controllers.add(controller);
    const status = element("p", "score-playback-status");
    status.setAttribute("role", "status");
    status.hidden = true;
    let playPending = false;
    const requestPlay = controller.play.bind(controller);
    controller.play = async () => {
      if (controller.disposed || playPending) return;
      stopOtherAudio(controller);
      playPending = true;
      if (playButton) playButton.disabled = true;
      controlsNode.setAttribute("aria-busy", "true");
      status.textContent = controller.isLoaded ? "" : "Preparing piano playback…";
      status.hidden = !status.textContent;
      try {
        // Keep audio activation in the play gesture, before any sample requests.
        ABCJS.synth.registerAudioContext();
        const context = ABCJS.synth.activeAudioContext();
        await context.resume();
        if (context.state !== "running") throw new Error("Audio output is suspended");
        if (controller.disposed || controller.playbackEpoch !== playbackEpoch) return;
        await requestPlay();
        status.hidden = true;
      } catch (error) {
        controller.pause();
        controller.isStarted = false;
        controller.isLoaded = false;
        controller.isLoading = false;
        controller.destroy();
        if (progress) progress.disabled = true;
        clearHighlight();
        if (!controller.disposed) {
          status.textContent = "Piano playback could not load. Press play to retry.";
          status.hidden = false;
          const recording = controlsNode.parentElement.querySelector(".recorded-score");
          if (recording) recording.open = true;
        }
      } finally {
        playPending = false;
        if (playButton) playButton.disabled = false;
        controlsNode.setAttribute("aria-busy", "false");
      }
    };
    controller.load(controlsNode, {
      onStart: () => stopOtherAudio(controller),
      onFinished: clearHighlight,
      onEvent: event => { if (!controller.disposed) highlight(event); },
    }, { displayRestart: true, displayPlay: true, displayProgress: true, displayLoop: true, displayWarp: false });
    controlsNode.append(status);
    const playButton = controlsNode.querySelector(".abcjs-midi-start");
    // Seeking before the first play must not start a second sample-loading job.
    const progress = controlsNode.querySelector(".abcjs-midi-progress-background");
    if (progress) progress.disabled = true;
    // Avoid an old, asynchronously loading tune starting after the selection changes.
    const originalPlay = controller._play.bind(controller);
    controller._play = () => controller.disposed || controller.playbackEpoch !== playbackEpoch
      ? Promise.resolve() : originalPlay();
    const originalGo = controller.go.bind(controller);
    controller.go = async () => {
      try {
        const result = await originalGo();
        if (controller.disposed) controller.destroy();
        else if (progress) progress.disabled = false;
        return result;
      } catch (error) {
        controller.isLoading = false;
        if (progress) progress.disabled = true;
        throw error;
      }
    };
    controller.setTune(visual, false, {
      soundFontUrl: "vendor/soundfonts/FluidR3_GM/",
      soundFontVolumeMultiplier: 3,
    });
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
    const searchable = searchText.get(row.id);
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
    if (name === "score") requestAnimationFrame(() => {
      if ($("scorePanel").hidden) return;
      mainController?.refreshView();
      const note = $("abcRenderedScore").querySelector(".playing-note");
      const frame = $("sheetFrame");
      if (note && frame.clientWidth) {
        const bounds = note.getBoundingClientRect();
        const viewport = frame.getBoundingClientRect();
        if (bounds.left < viewport.left + 12 || bounds.right > viewport.right - 12) {
          frame.scrollLeft += bounds.left - viewport.left - 24;
        }
      }
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
    if (id === selectedId) {
      if (shouldScroll) $("abc-cot-gen").scrollIntoView({ block: "start" });
      return;
    }
    cancelMainScore();
    disposeController(mainController);
    mainController = null;
    audioPlayers.releaseWithin($("musicAudio"));
    audioPlayers.releaseWithin($("recordedScore"));
    selectedId = id;
    $("currentDemo").dataset.trackId = `song:${id}`;
    $("selectedKicker").textContent = `${row.languageLabel} · Symbolic planning`;
    $("selectedTitle").textContent = row.title;
    $("musicAudio").replaceChildren(audioPlayer(row.audio, `${row.title}, generated song`, "planned"));
    const recordedScore = audioPlayer(row.scoreAudio, `${row.title}, original score recording`, "planned");
    $("recordedScore").replaceChildren(recordedScore);
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
    cancelMainScore = deferredScore(row.abc, $("abcRenderedScore"), $("abcSynth"), controller => {
      mainController = controller;
    }, () => {
      $("abcRenderedScore").replaceChildren(element("p", "notice", "The interactive score could not be rendered. Original score pages are available below."));
      $("abcSynth").replaceChildren(element("p", "notice", "Use the original score recording below."));
      $("originalScoreDetails").open = true;
      showOriginalPages(row);
    }, audioPlayers.transport(recordedScore));
    document.querySelectorAll(".case-item").forEach(node => {
      const active = node.dataset.id === id;
      node.classList.toggle("selected", active);
      node.setAttribute("aria-pressed", String(active));
    });
    if (shouldScroll) $("abc-cot-gen").scrollIntoView({ block: "start" });
    markCurrentTrack();
  }

  function railMatches() {
    const rows = planned.filter(row => matches(row, $("searchInput").value, $("languageFilter").value, $("genreFilter").value));
    const sort = $("sortSelect").value;
    if (sort === "curated") rows.sort((a, b) => a.order - b.order);
    if (sort === "genre") rows.sort((a, b) => a.genre.localeCompare(b.genre) || a.order - b.order);
    if (sort === "language") rows.sort((a, b) => a.languageLabel.localeCompare(b.languageLabel) || a.order - b.order);
    if (sort === "pages") rows.sort((a, b) => b.sheets.length - a.sheets.length || a.order - b.order);
    return rows;
  }

  function updateRailEdges() {
    const rail = $("caseRail");
    const horizontal = rail.scrollWidth > rail.clientWidth + 1;
    const position = horizontal ? rail.scrollLeft : rail.scrollTop;
    const extent = horizontal ? rail.scrollWidth - rail.clientWidth : rail.scrollHeight - rail.clientHeight;
    rail.parentElement.classList.toggle("can-scroll-back", position > 1);
    rail.parentElement.classList.toggle("can-scroll-forward", position < extent - 1);
  }

  function renderRail() {
    const rows = railMatches();
    $("railCount").textContent = `${rows.length} tracks`;
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
      cancelMainScore();
      disposeController(mainController);
      mainController = null;
      selectedId = null;
      audioPlayers.releaseWithin(document.querySelector(".case-stage"));
    } else {
      document.querySelector(".case-stage").hidden = false;
      if (!rows.some(row => row.id === selectedId)) selectCase(rows[0].id);
    }
    listening?.refreshQueue("planned");
    markCurrentTrack();
    updateRailEdges();
  }

  function openScore(id) {
    revealTrack(tracks.get(`song:${id}`), "score");
  }

  function textDetails(tags, lyrics) {
    const details = element("details", "content-details");
    details.dataset.view = "lyrics";
    details.append(element("summary", "", "Prompt & lyrics"));
    let populated = false;
    const populate = () => {
      if (populated) return;
      populated = true;
      const body = element("div", "detail-body");
      const heading = element("h4", "", "Lyrics");
      heading.dataset.lyricsHeading = "";
      heading.tabIndex = -1;
      body.append(element("h4", "", "Style prompt"), element("pre", "", tags), heading, element("pre", "", lyrics));
      body.append(button("Copy prompt & lyrics", "ghost-button", () => copyText(`${tags}\n\n${lyrics}`)));
      details.append(body);
    };
    details.revealLyrics = () => { populate(); details.open = true; return details.querySelector("[data-lyrics-heading]"); };
    details.addEventListener("toggle", () => {
      if (details.open) populate();
    });
    return details;
  }

  function coverCard(row, index) {
    const card = element("article", "cover-card");
    card.id = `cover-${row.id}`;
    card.dataset.trackId = `cover:${row.id}`;
    const header = element("header");
    const title = element("div");
    const [songTitle, ...variant] = row.title.split(" · ");
    const heading = element("h3", "", songTitle);
    if (row.titleZh) {
      const chineseTitle = element("span", "cover-title-zh", row.titleZh);
      chineseTitle.lang = "zh-Hans";
      heading.append(" ", chineseTitle);
    }
    title.append(heading);
    const nowPlaying = element("span", "now-playing-label", "Now playing");
    nowPlaying.hidden = true;
    title.append(nowPlaying);
    if (variant.length) title.append(element("p", "cover-variant", variant.join(" · ")));
    const source = element("p", "source-label");
    if (row.sourceUrl) {
      const link = element("a", "", row.source.replace(/^Adapted from /, ""));
      link.href = row.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = "Listen on YouTube (opens in a new tab)";
      if (row.sourceTitleZh) {
        const chineseSource = element("span", "", row.sourceTitleZh);
        chineseSource.lang = "zh-Hans";
        link.append(" (", chineseSource, ")");
      }
      link.setAttribute("aria-label", `${link.textContent} on YouTube (opens in a new tab)`);
      const arrow = element("span", "", " ↗");
      arrow.setAttribute("aria-hidden", "true");
      link.append(arrow);
      source.append("Adapted from ", link);
    } else source.textContent = row.source;
    title.append(source);
    header.append(element("span", "track-number", String(index + 1).padStart(2, "0")), title);
    card.append(header, element("span", "style-badge", row.genre), element("p", "edit-label", row.editType), audioPlayer(row.audio, `${row.title}, cover and editing example`, "covers"));
    card.append(textDetails(row.tags, row.lyrics));
    const details = element("details", "content-details");
    details.dataset.view = "score";
    details.append(element("summary", "", "ABC score & playback"));
    const controls = element("div", "cover-controls");
    const frame = element("div", "cover-score");
    const score = element("div", "cover-score-inner");
    frame.append(score);
    const raw = element("details", "detail-body");
    raw.append(element("summary", "", "Raw ABC"), element("pre", "cover-abc", row.abc));
    details.append(controls, frame, raw, button("Copy ABC", "ghost-button", () => copyText(row.abc)));
    let controller = null;
    let cancelScore = () => {};
    details.addEventListener("toggle", () => {
      if (details.open) {
        cancelScore = deferredScore(row.abc, score, controls, result => { controller = result; }, () => {
          score.replaceChildren(element("p", "notice", "Interactive score unavailable. The original ABC is included below."));
          controls.replaceChildren();
        });
      } else {
        cancelScore();
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
    card.dataset.trackId = `song:${row.id}`;
    const header = element("header");
    header.append(element("span", "song-number", `TRACK ${String(cases.indexOf(row) + 1).padStart(2, "0")}`), element("h3", "", row.title));
    const badges = element("div", "badge-row");
    badges.append(element("span", "badge", row.languageLabel), element("span", "badge", row.mode === "planned" ? "Symbolic planning" : "Direct generation"));
    header.append(badges);
    const nowPlaying = element("span", "now-playing-label", "Now playing");
    nowPlaying.hidden = true;
    header.append(nowPlaying);
    card.append(header, element("p", "tag-excerpt", row.tags), audioPlayer(row.audio, `${row.title}, ${row.languageLabel}, generated song`, "explorer"));
    if (row.mode === "planned") card.append(button("View the ABC score ↗", "text-link", () => openScore(row.id)));
    card.append(textDetails(row.tags, row.lyrics));
    return card;
  }

  function explorerMatches() {
    return cases.filter(row => matches(row, $("explorerSearch").value, $("explorerLanguage").value, $("explorerGenre").value, $("explorerMode").value));
  }

  function renderExplorer(append = false) {
    const rows = explorerMatches();
    const start = append ? $("explorerGrid").children.length : 0;
    if (!append) {
      audioPlayers.releaseWithin($("explorerGrid"));
      audioPlayers.releaseWithin($("explorerSpotlight"));
      $("explorerSpotlight").replaceChildren();
      $("explorerSpotlight").hidden = true;
      $("explorerGrid").replaceChildren();
    }
    $("explorerGrid").append(...rows.slice(start, explorerLimit).map(explorerCard));
    $("explorerStatus").textContent = rows.length ? `Showing ${Math.min(explorerLimit, rows.length)} of ${rows.length} selected songs` : "No songs match these filters.";
    $("loadMore").hidden = explorerLimit >= rows.length;
    listening?.refreshQueue("explorer");
    markCurrentTrack();
  }

  function renderMiniCases() {
    $("caseGrid").replaceChildren(...planned.map(row => {
      const item = button("", "mini-case", () => openScore(row.id));
      item.append(element("strong", "", row.title), element("small", "", row.languageLabel));
      return item;
    }));
  }

  function shuffleCollections() {
    cases = randomOrder(cases, "yue2-first-song");
    covers = randomOrder(covers, "yue2-first-cover");
    planned = cases.filter(item => item.mode === "planned");
    $("sortSelect").value = "random";
    renderRail();
    renderMiniCases();
    // Moving existing cover nodes preserves expanded scores and playback.
    covers.forEach((row, index) => {
      const card = $(`cover-${row.id}`);
      card.querySelector(".track-number").textContent = String(index + 1).padStart(2, "0");
      $("coverGrid").append(card);
    });
    renderExplorer();
  }

  function getQueue(scope) {
    if (scope === "agentic") return agenticRows.map(row => tracks.get(`agentic:${row.id}`));
    if (scope === "planned") return railMatches().map(row => tracks.get(`song:${row.id}`));
    if (scope === "covers") return covers.map(row => tracks.get(`cover:${row.id}`));
    if (scope === "explorer") return explorerMatches().map(row => tracks.get(`song:${row.id}`));
    return [...cases.map(row => tracks.get(`song:${row.id}`)), ...covers.map(row => tracks.get(`cover:${row.id}`)), ...agenticRows.map(row => tracks.get(`agentic:${row.id}`))];
  }

  function markCurrentTrack() {
    document.querySelectorAll(".cover-card, .explorer-card, .case-stage, .agentic-version").forEach(node => {
      const current = Boolean(currentTrack && node.dataset.trackId === currentTrack.id);
      node.classList.toggle("is-current-track", current);
      const label = node.querySelector(".now-playing-label");
      label.hidden = !current;
      label.textContent = currentState.loading ? "Loading…" : currentState.paused ? "Paused" : "Now playing";
    });
    document.querySelectorAll(".case-item").forEach(node => {
      const current = currentTrack?.id === `song:${node.dataset.id}`;
      node.classList.toggle("is-current-track", current);
      if (current) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  }

  function readingIsVisible() {
    const node = readingView?.node;
    if (!node?.isConnected || !node.getClientRects().length || node.closest("[hidden]") || node.closest("details:not([open])")) return false;
    if (node.closest("[data-track-id]")?.dataset.trackId !== readingView.id) return false;
    const rect = node.getBoundingClientRect();
    const bottom = $("listeningPlayer").getBoundingClientRect().top;
    return rect.bottom > 24 && rect.top < bottom - 40;
  }

  function syncCurrentTrack(track, state) {
    const follow = track && track.id !== currentTrack?.id && readingView?.id === currentTrack?.id && readingIsVisible();
    const view = readingView?.view;
    if (track?.id !== currentTrack?.id) revealRequest += 1;
    currentTrack = track;
    currentState = state;
    markCurrentTrack();
    if (follow) {
      const nextView = view === "score" && !track.hasScore ? (track.hasLyrics ? "lyrics" : "song")
        : view === "lyrics" && !track.hasLyrics ? "song" : view;
      revealTrack(track, nextView, { follow: true });
    }
  }

  function explorerTrack(row) {
    let card = $(`song-${row.id}`);
    if (card) return card;
    const rows = explorerMatches();
    const index = rows.findIndex(item => item.id === row.id);
    if (index >= 0) {
      explorerLimit = Math.max(explorerLimit, index + 1);
      renderExplorer(true);
    } else {
      // Reveal the playing song separately without changing search or queue filters.
      audioPlayers.releaseWithin($("explorerSpotlight"));
      $("explorerSpotlight").replaceChildren(explorerCard(row));
      $("explorerSpotlight").hidden = false;
    }
    return $(`song-${row.id}`);
  }

  function revealTrack(track, view = "song", { follow = false } = {}) {
    if (!track) return;
    const request = ++revealRequest;
    // End an earlier smooth jump before a tab resize changes scroll anchoring.
    window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: "instant" });
    let target, focus, reader;
    if (track.id.startsWith("agentic:")) {
      ({ target, focus, reader } = agenticStory?.reveal(track.rowId, view) || {});
    } else if (track.id.startsWith("cover:")) {
      const card = $(`cover-${track.rowId}`);
      target = focus = card.querySelector("h3");
      if (view === "lyrics") {
        const details = card.querySelector('[data-view="lyrics"]');
        target = focus = details.revealLyrics();
        reader = target.nextElementSibling;
      } else if (view === "score") {
        const details = card.querySelector('[data-view="score"]');
        details.open = true;
        target = focus = details.querySelector("summary");
        reader = details;
      }
    } else if (track.planned) {
      selectCase(track.rowId);
      if (view === "lyrics" || view === "score") {
        selectTab(view);
        target = document.querySelector(".tabs");
        focus = $(`${view}Tab`);
        reader = $(`${view}Panel`);
      } else target = focus = $("selectedTitle");
    } else {
      const row = cases.find(item => item.id === track.rowId);
      const card = explorerTrack(row);
      target = focus = card.querySelector("h3");
      if (view === "lyrics") {
        target = focus = card.querySelector('[data-view="lyrics"]').revealLyrics();
        reader = target.nextElementSibling;
      }
    }
    readingView = reader ? { id: track.id, view, node: reader } : null;
    markCurrentTrack();
    if (!target) return;
    target.classList.add("listening-destination");
    if (!focus.hasAttribute("tabindex") && !focus.matches("button, summary")) focus.tabIndex = -1;
    // Wait for details and tabs to open before measuring the destination.
    requestAnimationFrame(() => {
      if (request !== revealRequest || !target.isConnected) return;
      if (!follow) focus.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        if (request !== revealRequest || !target.isConnected) return;
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        // Scroll only the page; a score's own scroll position belongs to its clock.
        const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - 24);
        window.scrollTo({ top, behavior: follow || reduced ? "instant" : "smooth" });
      });
    });
  }

  const summary = data.summary;
  $("caseSummary").textContent = `${planned.length} cases`;
  $("genreDescription").textContent = `${summary.genreCount} songs, ${summary.genres} genres, ${summary.languages} languages. Find a style and press play.`;
  fillSelect($("languageFilter"), optionsFor(planned, "language", "languageLabel"), "All languages");
  fillSelect($("genreFilter"), optionsFor(planned, "genre"), "All genres");
  fillSelect($("explorerLanguage"), optionsFor(data.cases, "language", "languageLabel"), "All languages");
  fillSelect($("explorerGenre"), optionsFor(data.cases, "genre"), "All genres");
  $("searchInput").addEventListener("input", debounce(renderRail));
  ["languageFilter", "genreFilter", "sortSelect"].forEach(id => $(id).addEventListener("change", renderRail));
  $("caseRail").addEventListener("scroll", updateRailEdges, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(updateRailEdges).observe($("caseRail"));
  ["explorerSearch", "explorerLanguage", "explorerGenre", "explorerMode"].forEach(id => {
    const update = () => {
      explorerLimit = 12;
      renderExplorer();
    };
    $(id).addEventListener(id === "explorerSearch" ? "input" : "change", id === "explorerSearch" ? debounce(update) : update);
  });
  $("loadMore").addEventListener("click", () => {
    explorerLimit += 12;
    renderExplorer(true);
  });
  renderMiniCases();
  $("coverGrid").replaceChildren(...covers.map(coverCard));
  if (agenticData && window.YUE2AgenticEditing) agenticStory = window.YUE2AgenticEditing.mount({
    root: $("agenticStory"), data: agenticData, element, button, audioPlayer, copyText, deferredScore, disposeController,
  });
  renderRail();
  renderExplorer();
  listening = new window.YUE2ListeningPlayer({
    manager: audioPlayers, getTracks: getQueue, initialId: `song:${selectedId}`,
    onShuffle: shuffleCollections, onReveal: revealTrack, onCurrent: syncCurrentTrack,
    onSelect: (track, scope) => { if (scope === "planned" && !readingIsVisible()) selectCase(track.rowId); },
  });
})();
