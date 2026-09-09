"use strict";

(() => {
  const shuffled = (items, random = Math.random) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  window.YUE2Shuffle = shuffled;

  // A shuffled bag prevents repeats; history makes Previous retrace listening.
  window.YUE2Queue = class {
    constructor(items, initialId, random = Math.random) {
      this.random = random;
      this.shuffle = true;
      this.currentId = initialId;
      this.history = initialId ? [initialId] : [];
      this.cursor = this.history.length - 1;
      this.visited = new Set(this.history);
      this.setItems(items);
    }
    setItems(items) {
      this.items = [...new Map(items.map(item => [item.id, item])).values()];
      const allowed = new Set(this.items.map(item => item.id));
      this.remaining = (this.remaining || []).filter(id => allowed.has(id) && !this.visited.has(id));
      const unseen = this.items.map(item => item.id).filter(id => !this.visited.has(id) && !this.remaining.includes(id));
      this.remaining.push(...shuffled(unseen, this.random));
    }
    item(id = this.currentId) { return this.items.find(item => item.id === id); }
    select(id, remember = true) {
      if (!this.item(id)) return null;
      this.currentId = id;
      this.visited.add(id);
      this.remaining = this.remaining.filter(next => next !== id);
      if (remember && this.history[this.cursor] !== id) {
        this.history = this.history.slice(0, this.cursor + 1);
        this.history.push(id);
        if (this.history.length > 500) this.history.shift();
        this.cursor = this.history.length - 1;
      }
      return this.item();
    }
    reshuffle() {
      this.visited = new Set(this.currentId ? [this.currentId] : []);
      this.remaining = shuffled(this.items.filter(item => item.id !== this.currentId).map(item => item.id), this.random);
      this.history = this.history.slice(0, this.cursor + 1);
    }
    setShuffle(enabled) {
      this.shuffle = enabled;
      if (enabled) this.remaining = shuffled(this.remaining, this.random);
    }
    next() {
      if (!this.items.length) return null;
      while (this.cursor < this.history.length - 1) {
        const id = this.history[++this.cursor];
        if (this.item(id)) return this.select(id, false);
      }
      let id;
      if (this.shuffle) {
        if (!this.remaining.length) this.reshuffle();
        id = this.remaining.shift() || this.items[0].id;
      } else {
        const index = this.items.findIndex(item => item.id === this.currentId);
        id = this.items[(index + 1) % this.items.length].id;
      }
      return this.select(id);
    }
    previous() {
      if (!this.items.length) return null;
      while (this.cursor > 0) {
        const id = this.history[--this.cursor];
        if (this.item(id)) return this.select(id, false);
      }
      const index = this.items.findIndex(item => item.id === this.currentId);
      const id = this.items[(index - 1 + this.items.length) % this.items.length].id;
      this.history.unshift(id);
      this.cursor = 0;
      return this.select(id, false);
    }
  };

  const time = value => {
    const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const names = { all: "All songs", planned: "From score to song", covers: "Cover & Editing", explorer: "Genre Explorer" };

  window.YUE2ListeningPlayer = class {
    constructor({ manager, getTracks, initialId, onShuffle, onSelect, onReveal }) {
      this.manager = manager;
      this.getTracks = getTracks;
      this.onShuffle = onShuffle;
      this.onSelect = onSelect;
      this.onReveal = onReveal;
      this.scope = "all";
      this.root = document.getElementById("listeningPlayer");
      this.ui = Object.fromEntries([...this.root.querySelectorAll("[data-listening]")].map(node => [node.dataset.listening, node]));
      this.queue = new window.YUE2Queue(getTracks(this.scope), initialId);
      this.current = this.queue.item() || this.queue.items[0];
      this.player = null;
      this.transport = null;
      this.state = { paused: true, currentTime: 0, duration: 0, status: "" };
      this.ui.play.addEventListener("click", () => this.toggle());
      this.ui.previous.addEventListener("click", () => this.playTrack(this.queue.previous()));
      this.ui.next.addEventListener("click", () => this.playTrack(this.queue.next()));
      this.ui.shuffle.addEventListener("click", () => {
        this.queue.setShuffle(!this.queue.shuffle);
        this.render();
      });
      this.ui.reshuffle.addEventListener("click", () => {
        this.onShuffle();
        this.refreshQueue();
        this.queue.reshuffle();
        this.render();
        this.ui.status.textContent = "Queue reshuffled";
      });
      this.ui.collection.addEventListener("change", () => {
        this.scope = this.ui.collection.value;
        this.refreshQueue();
        const next = this.queue.item() || this.queue.items[0];
        if (next && next.id !== this.current?.id) {
          const wasPlaying = !this.state.paused;
          this.manager.stop();
          this.player = this.transport = null;
          this.current = this.queue.select(next.id);
          this.state = { paused: true, currentTime: 0, duration: 0, status: "" };
          if (wasPlaying) this.playTrack(this.current);
        }
        this.render();
      });
      this.ui.seek.addEventListener("input", () => this.transport?.seek(Number(this.ui.seek.value)));
      this.ui.volume.addEventListener("input", () => {
        this.manager.volume = Number(this.ui.volume.value);
        this.transport?.setVolume(this.manager.volume);
      });
      this.ui.title.addEventListener("click", () => this.current && this.onReveal(this.current));
      this.unsubscribe = manager.subscribe(event => this.onMedia(event));
      document.querySelectorAll("[data-shuffle-play]").forEach(button => {
        button.addEventListener("click", () => this.shufflePlay(button.dataset.shufflePlay));
      });
      this.root.hidden = false;
      document.body.classList.add("has-listening-player");
      const reserveSpace = () => document.documentElement.style.setProperty("--listening-height", `${this.root.getBoundingClientRect().height}px`);
      if (window.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(reserveSpace);
        this.resizeObserver.observe(this.root);
      }
      window.addEventListener("resize", reserveSpace);
      reserveSpace();
      this.installMediaSession();
      this.render();
    }
    refreshQueue(scope) {
      if (scope && this.scope !== scope && this.scope !== "all") return;
      this.queue.setItems(this.getTracks(this.scope));
      this.render();
    }
    shufflePlay(scope) {
      this.scope = scope;
      this.onShuffle();
      this.refreshQueue();
      this.queue.setShuffle(true);
      this.queue.reshuffle();
      this.playTrack(this.queue.next());
    }
    onMedia({ player, state, event }) {
      if (!player.metadata.id) return;
      if (player !== this.player || (state.active && player.metadata.context !== this.scope)) {
        if (!state.active) return;
        this.player = player;
        this.transport = this.manager.transport(player.shell);
        this.current = player.metadata;
        this.scope = player.metadata.context || this.scope;
        this.queue.setItems(this.getTracks(this.scope));
        this.queue.select(this.current.id);
        this.updateMediaMetadata();
      }
      this.state = state;
      this.render();
      if (event === "ended" && player.metadata.kind === "song") this.playTrack(this.queue.next());
    }
    playTrack(track) {
      if (!track) return;
      this.queue.select(track.id);
      this.onSelect(track, this.scope);
      let shell = [...document.querySelectorAll('.audio-player[data-audio-kind="song"]')]
        .find(node => node.dataset.trackId === track.id && !this.manager.parking.contains(node));
      if (!shell) {
        shell = this.manager.create(track.url, `${track.title}, generated song`, this.scope);
        this.manager.parking.replaceChildren(shell);
      }
      // The selected collection remains authoritative when a song has two cards.
      this.manager.players.get(shell).metadata.context = this.scope;
      if (this.manager.active?.player.url === track.url) this.manager.active.player.metadata.context = this.scope;
      const transport = this.manager.transport(shell);
      transport.seek(0);
      transport.play();
    }
    toggle() {
      if (this.transport) {
        if (!this.state.paused) this.transport.pause();
        else this.transport.play();
      } else this.playTrack(this.current || this.queue.items[0]);
    }
    render() {
      const { ui, state, current } = this;
      const title = current?.title || "Choose a song";
      if (ui.title.textContent !== title) ui.title.textContent = title;
      ui.title.title = title;
      ui.title.setAttribute("aria-label", `View ${title}`);
      const description = current?.kind === "score" ? "Original score recording" : current?.subtitle || "YuE2 listening collection";
      ui.detail.textContent = description;
      ui.collection.value = this.scope;
      ui.count.textContent = `${this.queue.items.length} songs`;
      ui.previous.disabled = ui.next.disabled = this.queue.items.length === 0;
      ui.play.disabled = !current;
      ui.reshuffle.disabled = this.queue.items.length < 2;
      ui.shuffle.setAttribute("aria-pressed", String(this.queue.shuffle));
      ui.shuffle.title = this.queue.shuffle ? "Shuffle on · no repeats until the queue finishes" : "Shuffle off · play in list order";
      const playing = !state.paused;
      ui.play.setAttribute("aria-label", playing ? "Pause" : "Play");
      ui.play.setAttribute("aria-pressed", String(playing));
      this.root.dataset.playing = String(playing);
      ui.elapsed.textContent = time(state.currentTime);
      ui.duration.textContent = time(state.duration);
      ui.seek.max = state.duration || 0;
      ui.seek.value = Math.min(state.currentTime || 0, state.duration || 0);
      ui.seek.disabled = !(state.duration > 0);
      ui.seek.setAttribute("aria-valuetext", `${time(state.currentTime)} of ${time(state.duration)}`);
      ui.seek.style.setProperty("--progress", `${state.duration > 0 ? Math.min(100, state.currentTime / state.duration * 100) : 0}%`);
      const status = state.status || (playing ? "Playing" : this.transport ? "Paused" : "Ready to play");
      if (ui.status.textContent !== status) ui.status.textContent = status;
      if (this.manager.active) ui.volume.value = this.manager.active.audio.volume;
      if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = playing ? "playing" : "paused";
        if (state.duration > 0 && navigator.mediaSession.setPositionState) {
          try { navigator.mediaSession.setPositionState({ duration: state.duration, playbackRate: this.manager.active?.audio.playbackRate || 1, position: Math.min(state.duration, Math.max(0, state.currentTime || 0)) }); } catch { /* Optional system controls. */ }
        }
      }
    }
    updateMediaMetadata() {
      if (navigator.mediaSession && window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({ title: this.current.title, artist: "YuE2", album: this.current.kind === "score" ? "Original score recording" : names[this.scope] });
    }
    installMediaSession() {
      if (!navigator.mediaSession) return;
      const actions = {
        play: () => this.transport ? this.transport.play() : this.toggle(),
        pause: () => this.transport?.pause(),
        previoustrack: () => this.playTrack(this.queue.previous()),
        nexttrack: () => this.playTrack(this.queue.next()),
        seekto: event => this.transport?.seek(event.seekTime),
        seekbackward: event => this.transport?.seek(this.state.currentTime - (event.seekOffset || 10)),
        seekforward: event => this.transport?.seek(this.state.currentTime + (event.seekOffset || 10)),
      };
      for (const [name, handler] of Object.entries(actions)) {
        try { navigator.mediaSession.setActionHandler(name, handler); } catch { /* Not every browser supports every action. */ }
      }
    }
  };
})();
