const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function element(tagName = "div") {
  const classes = new Set();
  return {
    tagName,
    value: "0",
    dataset: {},
    children: [],
    listeners: {},
    style: { setProperty() {} },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force = !classes.has(name)) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute() {},
    removeAttribute() {},
    scrollIntoView() {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) {
      this.children = children;
      if (this.tagName === "select") this.value = children[0]?.value || "";
    },
    querySelector() { return null; },
  };
}

const dlnaTracks = [
  { type: "track", queueItemId: "dlna-1", objectId: "track-1", serverId: "music", parentId: "album-1", title: "First track", artist: "Artist", album: "Local album", url: "http://music/1.mp3", duration: "0:03:00" },
  { type: "track", queueItemId: "dlna-2", objectId: "track-2", serverId: "music", parentId: "album-1", title: "Second track", artist: "Artist", album: "Local album", url: "http://music/2.mp3", duration: "0:03:00" },
];
const oldSpotifyEntry = { type: "spotifyTrack", track: { type: "spotify", uri: "spotify:track:old", title: "Old Spotify track" } };

function loadApp(playbackTarget = "ieast", globals = {}) {
  const nodes = new Map();
  const calls = [];
  const audioEvents = [];
  const timers = new Set();
  const responses = new Map();
  const context = vm.createContext({
    document: {
      body: element(),
      createElement: element,
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, element(selector === "#savedPlaylist" ? "select" : "div"));
        return nodes.get(selector);
      },
      querySelectorAll(selector) {
        if (selector !== "[data-action]") return [];
        const play = this.querySelector("#playButton");
        play.dataset.action = "play";
        return [play];
      },
    },
    Audio: class {
      paused = true;
      duration = 180;
      currentTime = 0;
      volume = 0.5;
      muted = false;
      listeners = {};
      _src = "";
      get src() { return this._src; }
      set src(value) {
        audioEvents.push({ type: "source", src: value });
        this._src = value;
        this.paused = true;
        this.currentTime = 0;
      }
      addEventListener(type, listener) { this.listeners[type] = listener; }
      pause() {
        if (this.paused) return;
        audioEvents.push({ type: "pause", src: this.src });
        this.paused = true;
        this.listeners.pause?.();
      }
      async play() {
        if (!this.src) throw new Error("No audio source loaded");
        audioEvents.push({ type: "play", src: this.src });
        this.paused = false;
        this.listeners.play?.();
      }
    },
    I18n: { t: (key) => key, error: (data) => data.error },
    setTimeout(callback) { const timer = { callback }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    URLSearchParams,
    TextDecoder,
    async fetch(url, options = {}) {
      calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
      if (context.fetchHandler) return context.fetchHandler(url, options);
      const data = responses.has(url) ? responses.get(url) : context.responseQueue;
      return { ok: true, async json() { return JSON.parse(JSON.stringify(data)); } };
    },
    ...globals,
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  vm.runInContext(source.replace(/\binitialize\(\);\s*$/, ""), context);
  vm.runInContext(`
    state.playbackTarget = ${JSON.stringify(playbackTarget)};
    state.selectionsInitialized = true;
    state.currentMedia = {};
    state.queue = { items: [], playlists: [], options: { autoNext: true } };
    $("#mediaServer").value = "music";
    selectPlaylistEntries([${JSON.stringify(oldSpotifyEntry)}]);
  `, context);

  function respondWith(items, playlists = []) {
    context.responseQueue = { items, playlists, index: -1, state: "stopped", options: { autoNext: true, continueAlbums: false, shuffle: false } };
  }
  function selections() {
    return JSON.parse(vm.runInContext("JSON.stringify([...state.selections.values()])", context));
  }
  return { context, nodes, calls, audioEvents, timers, responses, respondWith, selections };
}

for (const target of ["ieast", "computer"]) {
  test(`saving an exact album search uses that album on ${target}`, async () => {
    const app = loadApp(target);
    app.respondWith(dlnaTracks);
    Object.assign(app.context.responseQueue, { page: 1, pages: 1, total: 2, server: "Music" });
    await vm.runInContext('runSearch("Local album")', app.context);
    app.context.document.querySelector("#playlistName").value = "Local album";
    await app.nodes.get("#saveSelection").listeners.click();

    const save = app.calls.find((call) => call.url === "/api/playlists");
    assert.deepEqual(save.body.entries, [{ type: "album", serverId: "music", albumId: "album-1", album: "Local album" }]);
  });

  test(`saving an album opened from search does not save the previous Spotify queue on ${target}`, async () => {
    const app = loadApp(target);
    app.respondWith(dlnaTracks);
    app.context.responseQueue.album = "Local album";
    await vm.runInContext('loadAlbum("Local album")', app.context);
    app.context.document.querySelector("#playlistName").value = "Local album";
    await app.nodes.get("#saveSelection").listeners.click();

    const save = app.calls.find((call) => call.url === "/api/playlists");
    assert.deepEqual(save.body.entries, [{ type: "album", serverId: "music", albumId: "album-1", album: "Local album" }]);
  });

  test(`saving a DLNA album after Spotify playback saves the new album on ${target}`, async () => {
    const app = loadApp(target);
    app.respondWith(dlnaTracks);
    app.context.track = { ...dlnaTracks[0], id: "track-1", track: 1 };
    const row = vm.runInContext("createTrackRow(track)", app.context);
    await row.children.find((child) => child.className === "result-play").listeners.click();
    app.context.document.querySelector("#playlistName").value = "Local album";
    await app.nodes.get("#saveSelection").listeners.click();

    const save = app.calls.find((call) => call.url === "/api/playlists");
    assert.deepEqual(save.body.entries, [{ type: "album", serverId: "music", albumId: "album-1", album: "Local album" }]);
    assert.equal(app.calls[0].body.play, target === "ieast");
    if (target === "computer") assert.match(vm.runInContext("computerAudio.src", app.context), /dlna-1$/);
  });

  test(`playing a saved mixed playlist replaces the previous save selection on ${target}`, async () => {
    const app = loadApp(target);
    const entries = [
      { type: "album", serverId: "music", albumId: "album-1", album: "Local album" },
      { type: "track", serverId: "music", track: { ...dlnaTracks[1], objectId: "bonus-track", title: "Bonus track" } },
      { type: "spotifyTrack", track: { uri: "spotify:track:bonus", title: "Spotify bonus" } },
    ];
    const playlist = { id: "saved-mixed", name: "Mixed playlist", entries };
    app.context.playlist = playlist;
    vm.runInContext("state.queue.playlists = [playlist]", app.context);
    app.nodes.get("#savedPlaylist").value = playlist.id;
    app.respondWith([...dlnaTracks, entries[1].track, entries[2].track], [playlist]);
    await app.nodes.get("#playPlaylist").listeners.click();
    await app.nodes.get("#updatePlaylist").listeners.click();

    assert.deepEqual(app.selections(), entries);
    assert.deepEqual(app.calls.find((call) => call.method === "PUT").body.entries, entries);
    assert.equal(vm.runInContext("state.queue.items.length", app.context), 4);
  });
}

test("playing a single DLNA track replaces stale album selections", async () => {
  const app = loadApp();
  app.respondWith([dlnaTracks[0]]);
  app.context.track = { ...dlnaTracks[0], id: "track-1", track: 1 };
  vm.runInContext("state.queue.options.autoNext = false", app.context);
  const row = vm.runInContext("createTrackRow(track)", app.context);
  await row.children.find((child) => child.className === "result-play").listeners.click();

  assert.equal(app.selections().length, 1);
  assert.equal(app.selections()[0].type, "track");
  assert.equal(app.selections()[0].track.url, dlnaTracks[0].url);
});

test("status refreshes preserve selected whole albums instead of flattening them", () => {
  const app = loadApp();
  const album = { type: "album", serverId: "music", albumId: "album-1", album: "Local album" };
  app.context.album = album;
  app.respondWith(dlnaTracks);
  vm.runInContext("selectPlaylistEntries([album]); renderQueue(responseQueue)", app.context);
  assert.deepEqual(app.selections(), [album]);
});

test("opening another album preserves an explicitly selected mixed playlist", async () => {
  const app = loadApp();
  app.context.entries = [
    { type: "album", serverId: "music", albumId: "other-album", album: "Other album" },
    { type: "track", serverId: "music", track: dlnaTracks[0] },
  ];
  vm.runInContext("selectPlaylistEntries([])", app.context);
  for (let index = 0; index < app.context.entries.length; index += 1) {
    const checkbox = vm.runInContext(`selectionCheckbox("Select", selectionEntryKey(entries[${index}]), entries[${index}])`, app.context).children[0];
    checkbox.checked = true;
    checkbox.listeners.change();
  }
  app.respondWith(dlnaTracks);
  app.context.responseQueue.album = "Local album";
  await vm.runInContext('loadAlbum("Local album")', app.context);

  assert.deepEqual(app.selections(), app.context.entries);
});

test("opening a Spotify album replaces the previous implicit selection", async () => {
  const app = loadApp();
  app.respondWith([{ type: "track", uri: "spotify:track:new", title: "New track", subtitle: "Artist", detail: "New album" }]);
  Object.assign(app.context.responseQueue, { album: "New album", artist: "Artist" });
  await vm.runInContext('loadSpotifyAlbum("spotify:album:new")', app.context);

  assert.deepEqual(app.selections(), [{ type: "spotifyAlbum", uri: "spotify:album:new", album: "New album", artist: "Artist", artwork: null }]);
});

test("an album spanning multiple folders is saved by album name", async () => {
  const app = loadApp();
  app.respondWith([dlnaTracks[0], { ...dlnaTracks[1], parentId: "album-disc-2" }]);
  app.context.responseQueue.album = "Local album";
  await vm.runInContext('loadAlbum("Local album")', app.context);

  assert.deepEqual(app.selections(), [{ type: "album", serverId: "music", album: "Local album" }]);
});

test("a delayed initial queue refresh does not replace the album selected from search", async () => {
  const app = loadApp();
  vm.runInContext("state.selectionsInitialized = false", app.context);
  app.respondWith(dlnaTracks);
  app.context.responseQueue.album = "Local album";
  await vm.runInContext('loadAlbum("Local album")', app.context);
  app.respondWith([oldSpotifyEntry.track]);
  vm.runInContext("renderQueue(responseQueue)", app.context);

  assert.deepEqual(app.selections(), [{ type: "album", serverId: "music", albumId: "album-1", album: "Local album" }]);
});

async function changePlaybackTarget(app, target) {
  app.nodes.get("#playbackTarget").value = target;
  await app.nodes.get("#playbackTarget").listeners.change({ target: { value: target } });
  await vm.runInContext("refreshStatus()", app.context);
}

function assertComputerPlaying(app, index, playing) {
  assert.equal(vm.runInContext("computerAudio.paused", app.context), !playing);
  assert.equal(app.nodes.get("#playButton").dataset.action, playing ? "pause" : "play");
  assert.equal(app.context.document.body.classList.contains("is-playing"), playing, "record animation follows playback");
  const row = app.nodes.get("#queueList").children[index];
  assert.equal(row.children.find((child) => child.className === "queue-play").classList.contains("is-pause"), playing);
}

test("the main play button starts the current iEast queue track after switching to the computer", async () => {
  const app = loadApp();
  app.respondWith(dlnaTracks);
  Object.assign(app.context.responseQueue, { index: 1, state: "playing" });
  vm.runInContext('renderQueue(responseQueue); renderStatus({ status: "play", Title: "Second track" })', app.context);
  await changePlaybackTarget(app, "computer");

  assert.equal(await app.nodes.get("#playButton").listeners.click(), true);
  assert.match(vm.runInContext("computerAudio.src", app.context), /dlna-2$/);
  assertComputerPlaying(app, 1, true);
  assert.equal(app.calls.filter((call) => call.url === "/api/command")[0].body.action, "pause");
});

test("play and pause icons and the record follow computer playback after a target round trip", async () => {
  const app = loadApp("computer");
  app.respondWith(dlnaTracks);
  app.responses.set("/api/status", { status: "pause", Title: "First track" });
  vm.runInContext("renderQueue(responseQueue)", app.context);
  await vm.runInContext("playComputerQueueIndex(0)", app.context);
  vm.runInContext("computerAudio.currentTime = 42", app.context);
  assertComputerPlaying(app, 0, true);
  await changePlaybackTarget(app, "ieast");
  await changePlaybackTarget(app, "computer");

  await app.nodes.get("#playButton").listeners.click();
  assertComputerPlaying(app, 0, true);
  assert.equal(vm.runInContext("computerAudio.currentTime", app.context), 42, "resumes rather than restarting");
  await app.nodes.get("#playButton").listeners.click();
  assertComputerPlaying(app, 0, false);
  await app.nodes.get("#playButton").listeners.click();
  assertComputerPlaying(app, 0, true);
});

test("a replaced queue starts the new track instead of resuming obsolete computer audio", async () => {
  const app = loadApp("computer");
  app.respondWith(dlnaTracks);
  app.responses.set("/api/status", { status: "pause", Title: "First track" });
  vm.runInContext("renderQueue(responseQueue)", app.context);
  await vm.runInContext("playComputerQueueIndex(0)", app.context);
  await changePlaybackTarget(app, "ieast");
  app.respondWith([{ ...dlnaTracks[1], queueItemId: "replacement-track" }]);
  vm.runInContext("renderQueue(responseQueue)", app.context);
  await changePlaybackTarget(app, "computer");

  await app.nodes.get("#playButton").listeners.click();
  assert.match(vm.runInContext("computerAudio.src", app.context), /replacement-track$/);
  assertComputerPlaying(app, 0, true);
});

test("computer playback status remains correct when refreshing the server queue fails", async () => {
  const app = loadApp("computer");
  app.respondWith(dlnaTracks);
  vm.runInContext("renderQueue(responseQueue)", app.context);
  await vm.runInContext("playComputerQueueIndex(0)", app.context);
  vm.runInContext("clearComputerTrackHighlight()", app.context);
  app.context.fetchHandler = async () => { throw new Error("Queue server unavailable"); };
  await vm.runInContext("refreshStatus()", app.context);

  assertComputerPlaying(app, 0, true);
});

test("a delayed computer queue response is ignored after switching to iEast", async () => {
  const app = loadApp("computer");
  app.respondWith(dlnaTracks);
  vm.runInContext("renderQueue(responseQueue)", app.context);
  let releaseQueue;
  const pendingQueue = new Promise((resolve) => { releaseQueue = resolve; });
  app.context.fetchHandler = async (url) => {
    if (url === "/api/queue") return pendingQueue;
    return { ok: true, async json() { return { ok: true }; } };
  };
  const refresh = vm.runInContext("refreshStatus()", app.context);
  await changePlaybackTarget(app, "ieast");
  releaseQueue({ ok: true, async json() { return { ...app.context.responseQueue, items: [{ ...dlnaTracks[0], queueItemId: "stale-track" }] }; } });
  await refresh;

  assert.equal(vm.runInContext("state.queue.items[0].queueItemId", app.context), "dlna-1");
  assert.notEqual(app.nodes.get("#connectionText")?.textContent, "player.computerReady");
});

test("starting computer playback waits for the iEast pause during a target switch", async () => {
  const app = loadApp();
  app.respondWith(dlnaTracks);
  vm.runInContext("renderQueue(responseQueue)", app.context);
  let releasePause;
  let pauseStarted;
  const pendingPause = new Promise((resolve) => { releasePause = resolve; });
  const pausing = new Promise((resolve) => { pauseStarted = resolve; });
  app.context.fetchHandler = async (url) => {
    if (url === "/api/command") {
      pauseStarted();
      return pendingPause;
    }
    return { ok: true, async json() { return app.context.responseQueue; } };
  };
  const switching = changePlaybackTarget(app, "computer");
  await pausing;
  const starting = app.nodes.get("#playButton").listeners.click();
  assert.equal(vm.runInContext("computerAudio.src", app.context), "");
  releasePause({ ok: true, async json() { return { ok: true }; } });
  await Promise.all([switching, starting]);

  assertComputerPlaying(app, 0, true);
});

test("a queued computer start is cancelled when switching back to iEast", async () => {
  const app = loadApp();
  app.respondWith(dlnaTracks);
  vm.runInContext("renderQueue(responseQueue)", app.context);
  let releasePause;
  let pauseStarted;
  const pendingPause = new Promise((resolve) => { releasePause = resolve; });
  const pausing = new Promise((resolve) => { pauseStarted = resolve; });
  app.context.fetchHandler = async (url) => {
    if (url === "/api/command") {
      pauseStarted();
      return pendingPause;
    }
    return { ok: true, async json() { return app.context.responseQueue; } };
  };
  const switchingToComputer = changePlaybackTarget(app, "computer");
  await pausing;
  const starting = app.nodes.get("#playButton").listeners.click();
  const switchingToIeast = changePlaybackTarget(app, "ieast");
  releasePause({ ok: true, async json() { return { ok: true }; } });
  await Promise.all([switchingToComputer, starting, switchingToIeast]);

  assert.equal(vm.runInContext("computerAudio.src", app.context), "");
  assert.equal(vm.runInContext("computerAudio.paused", app.context), true);
  assert.equal(vm.runInContext("state.playbackTarget", app.context), "ieast");
});

test("selecting another queue track immediately pauses the previous computer track", async () => {
  const app = loadApp("computer");
  app.respondWith(dlnaTracks);
  vm.runInContext("renderQueue(responseQueue)", app.context);
  await vm.runInContext("playComputerQueueIndex(0)", app.context);
  const changingTrack = vm.runInContext("playComputerQueueIndex(1)", app.context);
  assert.equal(vm.runInContext("computerAudio.paused", app.context), true);
  await changingTrack;

  assert.deepEqual(app.audioEvents.map((event) => `${event.type}:${event.src.split("/").at(-1)}`), [
    "source:dlna-1", "play:dlna-1", "pause:dlna-1", "source:dlna-2", "play:dlna-2",
  ]);
  assertComputerPlaying(app, 1, true);
});

test("a delayed first track request cannot start after a newer track is selected", async () => {
  const app = loadApp("computer");
  app.respondWith(dlnaTracks);
  vm.runInContext("state.queue.options.autoNext = false", app.context);
  app.context.searchTracks = dlnaTracks.map((track) => ({ ...track, id: track.objectId }));
  const buttons = [0, 1].map((index) => vm.runInContext(`createTrackRow(searchTracks[${index}])`, app.context)
    .children.find((child) => child.className === "result-play"));
  let releaseFirst;
  let firstStarted;
  const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
  const firstRequest = new Promise((resolve) => { firstStarted = resolve; });
  app.context.fetchHandler = async (url, options) => {
    if (url === "/api/queue") {
      const body = JSON.parse(options.body);
      if (body.startObjectId === "track-1") {
        firstStarted();
        await firstResponse;
      }
      const track = dlnaTracks.find((item) => item.objectId === body.startObjectId);
      return { ok: true, async json() { return { ...app.context.responseQueue, items: [track] }; } };
    }
    return { ok: true, async json() { return {}; } };
  };
  const firstClick = buttons[0].listeners.click();
  await firstRequest;
  const secondClick = buttons[1].listeners.click();
  releaseFirst();
  await Promise.all([firstClick, secondClick]);

  assert.deepEqual(app.audioEvents.filter((event) => event.type === "play").map((event) => event.src), ["/api/local-media/queue/dlna-2"]);
  assert.equal(vm.runInContext("state.queue.items[0].title", app.context), "Second track");
  assertComputerPlaying(app, 0, true);
});

test("starting computer music in another controller window pauses the previous window", async () => {
  const channels = [];
  class PlaybackChannel {
    listeners = {};
    messages = [];
    constructor(name) { this.name = name; channels.push(this); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    postMessage(data) {
      this.messages.push(data);
      for (const other of channels) {
        if (other !== this && other.name === this.name) queueMicrotask(() => other.listeners.message({ data }));
      }
    }
  }
  const first = loadApp("computer", { BroadcastChannel: PlaybackChannel });
  const second = loadApp("computer", { BroadcastChannel: PlaybackChannel });
  for (const app of [first, second]) {
    app.respondWith(dlnaTracks);
    vm.runInContext("renderQueue(responseQueue)", app.context);
  }
  await vm.runInContext("playComputerQueueIndex(0)", first.context);
  await vm.runInContext("playComputerQueueIndex(1)", second.context);

  assertComputerPlaying(first, 0, false);
  assertComputerPlaying(second, 1, true);
  channels[0].postMessage(channels[0].messages[0]);
  await Promise.resolve();
  assertComputerPlaying(second, 1, true);

  await first.nodes.get("#playButton").listeners.click();
  assertComputerPlaying(first, 0, true);
  assertComputerPlaying(second, 1, false);
});
