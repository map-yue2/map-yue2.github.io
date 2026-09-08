"use strict";

// Keep one native media element alive, regardless of how many cards are shown.
window.YUE2Audio = class {
  constructor(beforePlay = () => {}) {
    this.beforePlay = beforePlay;
    this.active = null;
    this.positions = new Map();
    this.volume = 1;
    this.muted = false;
  }

  create(url, label) {
    const shell = document.createElement("div");
    shell.className = "audio-player";
    const activate = document.createElement("button");
    activate.type = "button";
    activate.className = "audio-activate";
    activate.setAttribute("aria-label", `Play ${label}`);
    const status = document.createElement("span");
    status.className = "audio-status";
    status.setAttribute("role", "status");
    const player = { shell, activate, status, url, label };
    this.reset(player);
    activate.addEventListener("click", () => this.play(player));
    shell.append(activate, status);
    return shell;
  }

  reset(player) {
    player.activate.hidden = false;
    player.activate.textContent = this.positions.get(player.url) > 0 ? "▶ Resume audio" : "▶ Play audio";
    player.status.textContent = "";
    player.shell.setAttribute("aria-busy", "false");
  }

  stop() {
    const active = this.active;
    if (!active) return;
    this.active = null; // Invalidate events and pending play promises before unloading.
    clearTimeout(active.timeout);
    const { audio, player, listeners } = active;
    const restoreFocus = player.shell.contains(document.activeElement);
    const position = audio.currentTime;
    if (audio.ended) this.positions.delete(player.url);
    else if (Number.isFinite(position) && position > 0) this.positions.set(player.url, position);
    this.volume = audio.volume;
    this.muted = audio.muted;
    listeners.forEach(([event, handler]) => audio.removeEventListener(event, handler));
    audio.pause();
    audio.removeAttribute("src");
    audio.load(); // Abort the old request and release its media resource.
    audio.remove();
    this.reset(player);
    if (restoreFocus) player.activate.focus({ preventScroll: true });
  }

  releaseWithin(root) {
    if (this.active && root.contains(this.active.player.shell)) this.stop();
  }

  play(player) {
    this.stop();
    this.beforePlay();
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.volume = this.volume;
    audio.muted = this.muted;
    audio.setAttribute("aria-label", player.label);
    const active = { player, audio, listeners: [], timeout: null };
    this.active = active;
    const listen = (event, handler) => {
      const guarded = () => { if (this.active === active) handler(); };
      audio.addEventListener(event, guarded);
      active.listeners.push([event, guarded]);
    };
    const ready = () => {
      clearTimeout(active.timeout);
      player.status.textContent = "";
      player.shell.setAttribute("aria-busy", "false");
    };
    const fail = message => {
      if (this.active !== active) return;
      this.stop();
      player.activate.textContent = "↻ Retry audio";
      player.status.textContent = message;
    };
    const loading = () => {
      player.status.textContent = "Loading audio…";
      player.shell.setAttribute("aria-busy", "true");
      if (!active.timeout) active.timeout = setTimeout(() => {
        fail("Audio is taking too long to load. Please retry.");
      }, 45000);
    };
    listen("loadedmetadata", () => {
      const position = this.positions.get(player.url);
      if (position > 0 && Number.isFinite(audio.duration) && position < audio.duration) {
        try { audio.currentTime = position; } catch { /* Playback can still start from the beginning. */ }
      }
    });
    listen("playing", () => { ready(); active.timeout = null; });
    listen("pause", () => { ready(); active.timeout = null; });
    listen("waiting", loading);
    listen("stalled", loading);
    listen("ended", () => this.stop());
    listen("error", () => fail("This audio could not load. Please try again."));
    player.activate.hidden = true;
    player.shell.insertBefore(audio, player.status);
    loading();
    // Assign the source and call play in the same user gesture (also on mobile).
    audio.src = player.url;
    try {
      Promise.resolve(audio.play()).catch(error => {
        if (this.active !== active) return;
        if (error.name === "AbortError") { ready(); active.timeout = null; return; }
        fail(error.name === "NotAllowedError"
          ? "Playback was blocked. Click to try again."
          : "This audio could not load. Please try again.");
      });
    } catch {
      fail("This audio could not load. Please try again.");
    }
    if (this.active === active) audio.focus({ preventScroll: true });
  }
};
