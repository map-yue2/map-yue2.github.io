"use strict";

// The recording owns time. Score controls and note highlighting only reflect it.
window.YUE2ScorePlayer = class {
  constructor({ visual, recording, controls, onEvent, revealRecording }) {
    this.recording = recording;
    this.onEvent = onEvent;
    this.revealRecording = revealRecording;
    this.disposed = false;
    this.isStarted = false;
    this.frame = null;
    this.lastEvent = null;
    this.events = new AbortController();
    this.timings = visual.setTiming(visual.getBpm(visual.metaText?.tempo), 0);
    this.scoreDuration = (this.timings.at(-1)?.milliseconds || 0) / 1000;

    const icons = {
      play: '<path d="M8 5v14l11-7z"/>',
      pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
      restart: '<path d="M5 5h3v14H5zm14 0v14L9 12z"/>',
      loop: '<path d="M19 7h-9a5 5 0 0 0-5 5m0 5h9a5 5 0 0 0 5-5M16 4l3 3-3 3M8 14l-3 3 3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    };
    const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
    const button = (label, name, callback) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = `abcjs-btn score-${name}`;
      node.setAttribute("aria-label", label);
      node.title = label;
      node.innerHTML = icon(name);
      node.addEventListener("click", callback, { signal: this.events.signal });
      return node;
    };
    const bar = document.createElement("div");
    bar.className = "abcjs-inline-audio score-transport";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Score recording playback");
    this.loopButton = button("Loop score recording", "loop", () => {
      recording.setLoop(!recording.state().loop);
    });
    const restart = button("Restart score recording", "restart", () => recording.seek(0));
    this.playButton = button("Play score recording", "play", () => {
      if (recording.state().paused) this.play();
      else this.pause();
    });
    this.progress = document.createElement("input");
    this.progress.type = "range";
    this.progress.className = "score-seek";
    this.progress.min = "0";
    this.progress.step = "0.01";
    this.progress.setAttribute("aria-label", "Score recording position");
    this.progress.addEventListener("input", () => recording.seek(Number(this.progress.value)), { signal: this.events.signal });
    this.clock = document.createElement("span");
    this.clock.className = "abcjs-midi-clock";
    this.clock.setAttribute("aria-hidden", "true");
    bar.append(this.loopButton, restart, this.playButton, this.progress, this.clock);
    this.status = document.createElement("p");
    this.status.className = "score-playback-status";
    this.status.setAttribute("role", "status");
    controls.replaceChildren(bar, this.status);

    this.paint = state => {
      if (this.disposed) return;
      const duration = state.duration > 0 ? state.duration : this.scoreDuration;
      const seconds = Math.max(0, state.currentTime);
      this.isStarted = !state.paused;
      const label = state.paused ? "Play score recording" : "Pause score recording";
      if (this.playButton.getAttribute("aria-label") !== label) {
        this.playButton.setAttribute("aria-label", label);
        this.playButton.title = label;
        this.playButton.innerHTML = icon(state.paused ? "play" : "pause");
      }
      this.playButton.setAttribute("aria-pressed", String(!state.paused));
      this.loopButton.setAttribute("aria-pressed", String(state.loop));
      this.progress.max = String(duration || 1);
      this.progress.value = String(Math.min(seconds, duration));
      this.progress.style.setProperty("--score-progress", `${duration ? Math.min(100, seconds / duration * 100) : 0}%`);
      const time = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
      this.clock.textContent = time(seconds);
      this.progress.setAttribute("aria-valuetext", `${time(seconds)} of ${time(duration)}`);
      this.status.textContent = state.status;
      this.status.hidden = !state.status;
      controls.setAttribute("aria-busy", String(state.loading));

      // Use absolute recording time, including when seeking backwards or buffering.
      let low = 0;
      let high = this.timings.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (this.timings[mid].milliseconds <= seconds * 1000) low = mid + 1;
        else high = mid;
      }
      const candidate = this.timings[low - 1];
      const event = (state.active || seconds > 0) && candidate?.type === "event" ? candidate : null;
      if (event !== this.lastEvent) {
        this.lastEvent = event;
        onEvent(event);
      }
    };
    const tick = () => {
      this.frame = null;
      if (this.disposed) return;
      const state = recording.state();
      this.paint(state);
      if (state.playing) this.frame = requestAnimationFrame(tick);
    };
    this.unsubscribe = recording.subscribe(state => {
      this.paint(state);
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = !this.disposed && state.playing ? requestAnimationFrame(tick) : null;
    });
  }

  play() {
    if (this.disposed) return;
    this.revealRecording();
    this.recording.play();
  }

  pause() {
    this.recording.pause();
  }

  refreshView() {
    if (this.disposed) return;
    // A seek while the score is hidden still needs to reveal its current staff.
    this.onEvent(null);
    this.onEvent(this.lastEvent);
  }

  destroy() {
    this.disposed = true;
    this.events.abort();
    this.unsubscribe();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.onEvent(null);
  }
};
