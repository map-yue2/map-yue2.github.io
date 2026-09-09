"use strict";

// Keep one native media element alive, regardless of how many cards are shown.
window.YUE2Audio = class {
  constructor(beforePlay = () => {}, { describe = () => ({}), parking = null } = {}) {
    this.beforePlay = beforePlay;
    this.describe = describe;
    this.parking = parking;
    this.subscribers = new Set();
    this.nextAudio = null;
    this.active = null;
    this.positions = new Map();
    this.players = new WeakMap();
    this.volume = 1;
    this.muted = false;
  }

  create(url, label, context) {
    const shell = document.createElement("div");
    shell.className = "audio-player";
    const activate = document.createElement("button");
    activate.type = "button";
    activate.className = "audio-activate";
    activate.setAttribute("aria-label", `Play ${label}`);
    const status = document.createElement("span");
    status.className = "audio-status";
    status.setAttribute("role", "status");
    const metadata = { ...this.describe(url), ...(context ? { context } : {}) };
    if (metadata.id) shell.dataset.trackId = metadata.id;
    shell.dataset.audioKind = metadata.kind || "song";
    const player = { shell, activate, status, url, label, metadata, homeContext: metadata.context, duration: 0, loop: false,
      playing: false, loading: false, subscribers: new Set() };
    this.players.set(shell, player);
    this.reset(player);
    activate.addEventListener("click", () => {
      player.metadata.context = player.homeContext;
      this.play(player);
    });
    shell.append(activate, status);
    return shell;
  }

  snapshot(player) {
    const active = this.active?.player === player ? this.active : null;
    const audio = active?.audio;
    return {
      active: Boolean(audio),
      currentTime: audio ? active.pendingSeek ?? audio.currentTime : this.positions.get(player.url) || 0,
      duration: audio && Number.isFinite(audio.duration) ? audio.duration : player.duration,
      paused: !audio || (audio.paused && !player.loading),
      playing: Boolean(audio && !audio.paused && player.playing),
      loop: audio ? audio.loop : player.loop,
      loading: player.loading,
      status: player.status.textContent,
    };
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify(player, event = "state") {
    const state = this.snapshot(player);
    player.subscribers.forEach(callback => callback(state));
    this.subscribers.forEach(callback => callback({ player, state, event }));
  }

  // Both score controls and native controls use this same media element and clock.
  transport(shell) {
    const player = this.players.get(shell);
    if (!player) throw new Error("Unknown audio player");
    return {
      state: () => this.snapshot(player),
      subscribe: callback => {
        player.subscribers.add(callback);
        callback(this.snapshot(player));
        return () => player.subscribers.delete(callback);
      },
      play: () => this.play(player, { focus: false }),
      pause: () => {
        if (this.active?.player === player) this.active.pause();
      },
      seek: seconds => {
        if (!Number.isFinite(seconds)) return;
        const active = this.active?.player.url === player.url ? this.active : null;
        const duration = active && Number.isFinite(active.audio.duration) ? active.audio.duration : this.snapshot(player).duration;
        const position = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);
        this.positions.set(player.url, position);
        if (active) {
          active.pendingSeek = position;
          try {
            active.audio.currentTime = position;
            if (active.metadataLoaded) active.pendingSeek = null;
          } catch { /* Restore after metadata loads. */ }
        }
        this.notify(player);
        if (active && active.player !== player) this.notify(active.player);
      },
      setLoop: loop => {
        player.loop = Boolean(loop);
        if (this.active?.player === player) this.active.audio.loop = player.loop;
        this.notify(player);
      },
      setVolume: volume => {
        this.volume = Math.max(0, Math.min(1, volume));
        if (this.active?.player === player) this.active.audio.volume = this.volume;
      },
    };
  }

  reset(player) {
    player.activate.hidden = false;
    player.activate.textContent = this.positions.get(player.url) > 0 ? "Resume audio" : "Play audio";
    player.status.textContent = "";
    player.loading = false;
    player.playing = false;
    player.shell.setAttribute("aria-busy", "false");
  }

  stop() {
    const active = this.active;
    if (!active) return;
    this.active = null; // Invalidate events and pending play promises before unloading.
    clearTimeout(active.timeout);
    const { audio, player, listeners } = active;
    const restoreFocus = player.shell.contains(document.activeElement);
    const position = active.pendingSeek ?? audio.currentTime;
    if (audio.ended) this.positions.delete(player.url);
    else if (Number.isFinite(position) && position >= 0) this.positions.set(player.url, position);
    this.volume = audio.volume;
    this.muted = audio.muted;
    if (Number.isFinite(audio.duration)) player.duration = audio.duration;
    player.loop = audio.loop;
    listeners.forEach(([event, handler]) => audio.removeEventListener(event, handler));
    audio.pause();
    audio.removeAttribute("src");
    audio.load(); // Abort the old request and release its media resource.
    audio.remove();
    this.reset(player);
    this.notify(player);
    if (restoreFocus) player.activate.focus({ preventScroll: true });
  }

  releaseWithin(root) {
    if (!this.active || !root.contains(this.active.player.shell)) return;
    if (this.parking && this.active.player.metadata.kind === "song") {
      // Keep the current song alive when filtering or changing the visible card.
      this.parking.replaceChildren(this.active.player.shell);
    } else this.stop();
  }

  play(player, { focus = true } = {}) {
    if (this.active?.player !== player && this.active?.player.url === player.url) {
      const owner = this.active.player;
      owner.metadata.context = player.metadata.context;
      this.play(owner, { focus: false });
      this.notify(owner);
      return;
    }
    if (this.active?.player === player) {
      this.beforePlay();
      if (!this.active.audio.paused && player.playing) return;
      this.active.start(focus);
      return;
    }
    this.stop();
    this.beforePlay();
    const audio = this.nextAudio || document.createElement("audio");
    this.nextAudio = null;
    audio.controls = true;
    audio.preload = "none";
    audio.volume = this.volume;
    audio.muted = this.muted;
    audio.loop = player.loop;
    audio.setAttribute("aria-label", player.label);
    const active = { player, audio, listeners: [], timeout: null, playAttempt: 0,
      metadataLoaded: false, pendingSeek: this.positions.get(player.url) ?? null };
    this.active = active;
    const listen = (event, handler) => {
      const guarded = () => { if (this.active === active) handler(); };
      audio.addEventListener(event, guarded);
      active.listeners.push([event, guarded]);
    };
    const ready = () => {
      clearTimeout(active.timeout);
      active.timeout = null;
      player.loading = false;
      player.status.textContent = "";
      player.shell.setAttribute("aria-busy", "false");
    };
    const fail = message => {
      if (this.active !== active) return;
      this.stop();
      player.activate.textContent = "Retry audio";
      player.status.textContent = message;
      this.notify(player);
    };
    const loading = () => {
      player.status.textContent = "Loading audio…";
      player.loading = true;
      player.shell.setAttribute("aria-busy", "true");
      if (!active.timeout) active.timeout = setTimeout(() => {
        fail("Audio is taking too long to load. Please retry.");
      }, 45000);
      this.notify(player);
    };
    listen("loadedmetadata", () => {
      active.metadataLoaded = true;
      if (Number.isFinite(audio.duration)) player.duration = audio.duration;
      const position = this.positions.get(player.url);
      if (position >= 0 && Number.isFinite(audio.duration)) {
        try {
          audio.currentTime = Math.min(position, audio.duration);
          active.pendingSeek = null;
        } catch { /* Playback can still start from the beginning. */ }
      }
      this.notify(player);
    });
    listen("play", () => { this.beforePlay(); player.playing = false; loading(); });
    listen("playing", () => { player.playing = true; ready(); this.notify(player); });
    listen("pause", () => {
      active.playAttempt += 1;
      player.playing = false;
      ready();
      this.notify(player);
    });
    listen("waiting", () => { if (!audio.paused) { player.playing = false; loading(); } });
    listen("stalled", () => { if (!audio.paused) loading(); });
    for (const event of ["timeupdate", "seeking", "seeked", "durationchange", "ratechange", "volumechange"]) {
      listen(event, () => this.notify(player));
    }
    listen("ended", () => {
      this.stop();
      // Reuse the user-activated element for continuous playback on mobile.
      this.nextAudio = this.parking && player.metadata.kind === "song" ? audio : null;
      this.notify(player, "ended");
      this.nextAudio = null;
    });
    listen("error", () => fail("This audio could not load. Please try again."));
    player.activate.hidden = true;
    player.shell.insertBefore(audio, player.status);
    active.pause = () => {
      active.playAttempt += 1;
      player.playing = false;
      ready();
      audio.pause();
      this.notify(player);
    };
    active.start = shouldFocus => {
      const attempt = ++active.playAttempt;
      loading();
      try {
        Promise.resolve(audio.play()).catch(error => {
          if (this.active !== active || attempt !== active.playAttempt) return;
          if (error.name === "AbortError") { ready(); this.notify(player); return; }
          fail(error.name === "NotAllowedError"
            ? "Playback was blocked. Click to try again."
            : "This audio could not load. Please try again.");
        });
      } catch {
        fail("This audio could not load. Please try again.");
      }
      if (shouldFocus && this.active === active) audio.focus({ preventScroll: true });
    };
    // Assign the source and call play in the same user gesture (also on mobile).
    audio.src = player.url;
    active.start(focus);
  }
};
