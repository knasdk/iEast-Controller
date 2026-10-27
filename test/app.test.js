const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function element(tagName = "div") {
  const classes = new Set();
  const properties = new Map();
  return {
    tagName,
    value: "0",
    dataset: {},
    children: [],
    listeners: {},
    style: {
      setProperty(name, value) { properties.set(name, value); },
      getPropertyValue(name) { return properties.get(name) || ""; },
    },
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
  const storage = new Map([["ieast-playback-target", playbackTarget]]);
  const context = vm.createContext({
    document: {
      body: element(),
      documentElement: element("html"),
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
    I18n: { t: (key) => key, error: (data) => data.error, localeNames: { da: "Dansk" }, setLocale() {}, apply() {} },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    location: { search: "", pathname: "/" },
    setTimeout(callback) { const timer = { callback }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    setInterval() {},
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
  return { context, nodes, calls, audioEvents, timers, responses, storage, respondWith, selections };
}

const spotifyTracks = [
  { type: "spotify", queueItemId: "spotify-1", uri: "spotify:track:first", title: "First Spotify track", artist: "Artist", durationMs: 180000 },
  { type: "spotify", queueItemId: "spotify-2", uri: "spotify:track:second", title: "Current Spotify track", artist: "Artist", durationMs: 180000 },
];

function spotifyPlaybackResponses(app, status = "play") {
  app.respondWith(spotifyTracks);
  Object.assign(app.context.responseQueue, { index: 0, state: "playing" });
  app.responses.set("/api/config", { language: "da", theme: "dark", mediaServers: [], radios: [] });
  app.responses.set("/api/spotify/devices", { devices: [
    { id: "streamer", type: "AVR", name: "iEast", active: false },
    { id: "computer", type: "Computer", name: "This computer", active: true },
  ] });
  const playback = {
    active: true, status, Title: spotifyTracks[1].title, Artist: "Artist", Album: "Album",
    spotifyUri: spotifyTracks[1].uri, artwork: "https://example.com/current.jpg",
    curpos: 90000, totlen: 180000, mediaType: "track", vol: 42, mute: 0,
  };
  app.responses.set("/api/spotify/playback?deviceId=computer", playback);
  return playback;
}

for (const status of ["play", "pause"]) {
  test(`reloading reconnects to ${status === "play" ? "playing" : "paused"} Spotify on the computer without restarting it`, async () => {
    const app = loadApp("computer");
    const playback = spotifyPlaybackResponses(app, status);
    await vm.runInContext("initialize()", app.context);

    assert.equal(vm.runInContext("state.computerSource", app.context), "spotify-connect");
    assert.equal(vm.runInContext("state.computerSpotifyDeviceId", app.context), "computer");
    assert.equal(vm.runInContext("state.computerQueueIndex", app.context), 1);
    assert.equal(app.nodes.get("#title").textContent, playback.Title);
    assert.equal(app.nodes.get("#currentTime").textContent, "1:30");
    assert.equal(app.nodes.get("#duration").textContent, "3:00");
    assert.equal(app.nodes.get("#cover").src, playback.artwork);
    assert.equal(app.nodes.get("#volumeValue").textContent, 42);
    assert.equal(app.nodes.get("#artwork").style.getPropertyValue("--tonearm-angle"), "8.25deg");
    assert.equal(app.context.document.body.classList.contains("is-playing"), status === "play");
    assert.equal(app.nodes.get("#queueList").children[1].classList.contains("current"), true);
    assert.equal(app.calls.some(call => call.method && call.method !== "GET"), false, "reconnection must only read playback state");
    assert.deepEqual(app.audioEvents, [], "reconnection must not start local audio");
  });
}

test("a remembered Spotify computer is preferred over an unrelated active computer", async () => {
  const app = loadApp("computer");
  spotifyPlaybackResponses(app);
  app.storage.set("ieast-computer-spotify-device", "computer");
  app.responses.set("/api/spotify/devices", { devices: [
    { id: "other-computer", type: "Computer", active: true },
    { id: "computer", type: "Computer", active: false },
  ] });
  await vm.runInContext("initialize()", app.context);

  assert.equal(vm.runInContext("state.computerSpotifyDeviceId", app.context), "computer");
  assert.equal(app.calls.some(call => call.url.includes("deviceId=other-computer")), false);
});

test("Spotify playback on another device is not restored as computer playback", async () => {
  const app = loadApp("computer");
  spotifyPlaybackResponses(app);
  app.responses.set("/api/spotify/playback?deviceId=computer", { active: false, reason: "other-device" });
  await vm.runInContext("initialize()", app.context);

  assert.equal(vm.runInContext("state.computerSource", app.context), null);
  assert.equal(app.context.document.body.classList.contains("is-playing"), false);
  assert.equal(app.calls.some(call => call.method && call.method !== "GET"), false);
});

test("a failed initial Spotify lookup is retried on the next status refresh", async () => {
  const app = loadApp("computer");
  spotifyPlaybackResponses(app);
  app.context.fetchHandler = async (url) => {
    if (url === "/api/spotify/devices") throw new Error("Temporary Spotify failure");
    return { ok: true, async json() { return app.context.responseQueue; } };
  };
  await vm.runInContext("refreshStatus()", app.context);
  delete app.context.fetchHandler;
  await vm.runInContext("refreshStatus()", app.context);

  assert.equal(vm.runInContext("state.computerSource", app.context), "spotify-connect");
  assert.equal(app.nodes.get("#title").textContent, spotifyTracks[1].title);
});

test("Spotify restoration cannot overwrite a newer local playback request", async () => {
  const app = loadApp("computer");
  app.respondWith(dlnaTracks);
  vm.runInContext("renderQueue(responseQueue)", app.context);
  let releaseDevices;
  let devicesStarted;
  const pendingDevices = new Promise(resolve => { releaseDevices = resolve; });
  const requestingDevices = new Promise(resolve => { devicesStarted = resolve; });
  app.context.fetchHandler = async (url) => {
    if (url === "/api/spotify/devices") { devicesStarted(); return pendingDevices; }
    return { ok: true, async json() { return app.context.responseQueue; } };
  };
  const refresh = vm.runInContext("refreshStatus()", app.context);
  await requestingDevices;
  await vm.runInContext("playComputerQueueIndex(0)", app.context);
  releaseDevices({ ok: true, async json() { return { devices: [{ id: "computer", type: "Computer", active: true }] }; } });
  await refresh;

  assert.equal(vm.runInContext("state.computerSource", app.context), "audio");
  assert.equal(app.nodes.get("#title").textContent, dlnaTracks[0].title);
  assert.equal(app.calls.some(call => call.url.startsWith("/api/spotify/playback")), false);
});

test("a delayed Spotify restoration response is ignored after switching to iEast", async () => {
  const app = loadApp("computer");
  const playback = spotifyPlaybackResponses(app);
  let releasePlayback;
  let playbackStarted;
  const pendingPlayback = new Promise(resolve => { releasePlayback = resolve; });
  const requestingPlayback = new Promise(resolve => { playbackStarted = resolve; });
  app.context.fetchHandler = async (url) => {
    if (url.startsWith("/api/spotify/playback")) { playbackStarted(); return pendingPlayback; }
    return { ok: true, async json() { return app.responses.get(url) || app.context.responseQueue; } };
  };
  const refresh = vm.runInContext("refreshStatus()", app.context);
  await requestingPlayback;
  await changePlaybackTarget(app, "ieast");
  vm.runInContext('renderStatus({ status: "play", Title: "Current iEast track" })', app.context);
  releasePlayback({ ok: true, async json() { return playback; } });
  await refresh;

  assert.equal(vm.runInContext("state.playbackTarget", app.context), "ieast");
  assert.equal(vm.runInContext("state.computerSource", app.context), null);
  assert.equal(app.nodes.get("#title").textContent, "Current iEast track");
});

test("Spotify tracks outside the saved queue are restored without claiming a queue item", async () => {
  const app = loadApp("computer");
  const playback = spotifyPlaybackResponses(app);
  playback.spotifyUri = "spotify:track:external";
  await vm.runInContext("initialize()", app.context);
  await vm.runInContext("refreshStatus()", app.context);

  assert.equal(app.nodes.get("#title").textContent, playback.Title);
  assert.equal(vm.runInContext("state.computerQueueIndex", app.context), -1);
  assert.equal(vm.runInContext("state.computerQueueItemId", app.context), "");
  assert.equal(app.calls.some(call => call.method && call.method !== "GET"), false);
});

test("moving Spotify playback to another device clears stale computer playback", async () => {
  const app = loadApp("computer");
  spotifyPlaybackResponses(app);
  await vm.runInContext("initialize()", app.context);
  app.responses.set("/api/spotify/playback?deviceId=computer", { active: false, reason: "other-device" });
  await vm.runInContext("refreshStatus()", app.context);

  assert.equal(vm.runInContext("state.computerSource", app.context), null);
  assert.equal(vm.runInContext("state.computerQueueIndex", app.context), -1);
  assert.equal(app.context.document.body.classList.contains("is-playing"), false);
  assert.equal(app.nodes.get("#artwork").style.getPropertyValue("--tonearm-angle"), "-24deg");
});

test("an existing Spotify connection follows the live track in the queue", async () => {
  const app = loadApp("computer");
  spotifyPlaybackResponses(app);
  vm.runInContext(`
    state.computerSource = "spotify-connect";
    state.computerSpotifyDeviceId = "computer";
    state.computerQueueIndex = 0;
    state.computerQueueItemId = "spotify-1";
    state.queue = responseQueue;
  `, app.context);
  await vm.runInContext("refreshStatus()", app.context);

  assert.equal(vm.runInContext("state.computerQueueIndex", app.context), 1);
  assert.equal(vm.runInContext("state.computerQueueItemId", app.context), "spotify-2");
  assert.equal(app.nodes.get("#queueList").children[1].classList.contains("current"), true);
});

test("iEast playback is rendered immediately without waiting for tone controls", async () => {
  const app = loadApp();
  app.respondWith(dlnaTracks);
  vm.runInContext("state.deviceLoaded = true", app.context);
  let releaseTone;
  let toneStarted;
  const pendingTone = new Promise(resolve => { releaseTone = resolve; });
  const requestingTone = new Promise(resolve => { toneStarted = resolve; });
  app.context.fetchHandler = async (url) => {
    if (url === "/api/tone") { toneStarted(); return pendingTone; }
    return { ok: true, async json() { return url === "/api/status" ? { status: "play", Title: "Current iEast track", curpos: 90000, totlen: 180000 } : app.context.responseQueue; } };
  };
  const refresh = vm.runInContext("refreshStatus()", app.context);
  await requestingTone;
  const title = app.nodes.get("#title")?.textContent;
  const angle = app.nodes.get("#artwork")?.style.getPropertyValue("--tonearm-angle");
  releaseTone({ ok: true, async json() { return { bass: 0, treble: 0 }; } });
  await refresh;
  assert.equal(title, "Current iEast track");
  assert.equal(angle, "8.25deg");
});

test("track durations consistently format milliseconds and legacy DLNA times", () => {
  const app = loadApp();
  for (const [item, expected] of [
    [{ durationMs: 222500 }, "3:42"],
    [{ durationMs: 3723250 }, "1:02:03"],
    [{ durationMs: 222500, duration: "0:04:00" }, "3:42"],
    [{ duration: "0:03:42.500" }, "3:42"],
    [{ duration: "03:42" }, "3:42"],
    [{ duration: "1:02:03.250" }, "1:02:03"],
    [{ durationMs: 0, duration: "0:03:42" }, "3:42"],
    [{ durationMs: -1, duration: "0:03:42" }, "3:42"],
    [{}, "–"],
    [{ durationMs: 0 }, "–"],
    [{ durationMs: -1 }, "–"],
    [{ durationMs: Infinity }, "–"],
    [{ durationMs: "invalid" }, "–"],
    [{ duration: "NOT_IMPLEMENTED" }, "–"],
    [{ duration: "0:00:00" }, "–"],
  ]) {
    app.context.durationItem = item;
    assert.equal(vm.runInContext("formatTrackDuration(durationItem)", app.context), expected, JSON.stringify(item));
  }
});

for (const renderer of ["renderSearchResults(tracks)", "renderBrowseEntries([], tracks)"]) {
  test(`${renderer} displays known and unknown DLNA track durations`, () => {
    const app = loadApp();
    app.context.tracks = [
      { ...dlnaTracks[0], duration: "0:03:42.500" },
      { ...dlnaTracks[1], duration: undefined, durationMs: 180000 },
      { title: "Unknown duration" },
    ];
    vm.runInContext(renderer, app.context);
    assert.deepEqual(app.nodes.get("#searchResults").children.map((row) => row.children[3].textContent), ["3:42", "3:00", "–"]);
  });
}

test("Spotify search and album tracks display durations without replacing other result types", () => {
  const app = loadApp();
  app.context.tracks = [
    { type: "track", uri: "spotify:track:1", title: "Search track", durationMs: 222500 },
    { type: "track", uri: "spotify:track:2", title: "Album track", track: 2, durationMs: 3723250 },
    { type: "track", uri: "spotify:track:3", title: "Unknown duration" },
    { type: "album", uri: "spotify:album:1", title: "Album" },
    { type: "artist", uri: "spotify:artist:1", title: "Artist" },
    { type: "playlist", uri: "spotify:playlist:1", title: "Playlist" },
  ];
  vm.runInContext("renderSpotifyResults(tracks)", app.context);
  const metadata = app.nodes.get("#searchResults").children.map((row) => row.children[3]);
  assert.deepEqual(metadata.map((node) => node.textContent), ["3:42", "1:02:03", "–", "spotify.type.album", "spotify.type.artist", "spotify.type.playlist"]);
  assert.equal(metadata[0].className, "track-duration result-duration");
  assert.equal(metadata[3].className, "spotify-type");
  assert.equal(vm.runInContext("spotifyTrackQueueEntry(tracks[0]).track.durationMs", app.context), 222500);
});

test("the queue shows durations for DLNA and Spotify tracks", () => {
  const app = loadApp();
  app.respondWith([
    dlnaTracks[0],
    { type: "spotify", uri: "spotify:track:1", title: "Spotify track", durationMs: 222500 },
    { title: "Unknown duration" },
  ]);
  vm.runInContext("renderQueue(responseQueue)", app.context);
  assert.deepEqual(app.nodes.get("#queueList").children.map((row) => row.children[5].textContent), ["3:00", "3:42", "–"]);
});

test("saved playlists show individual track durations but do not invent album durations", () => {
  const app = loadApp();
  app.respondWith([], [{
    id: "mixed", name: "Mixed", entries: [
      { type: "track", track: dlnaTracks[0] },
      { type: "spotifyTrack", track: { title: "Spotify track", durationMs: 222500 } },
      { type: "track", title: "Legacy track", duration: "1:02:03" },
      { type: "spotifyTrack", track: { title: "Unknown duration" } },
      { type: "album", album: "Local album" },
      { type: "spotifyAlbum", album: "Spotify album" },
    ],
  }]);
  vm.runInContext("renderQueue(responseQueue)", app.context);
  assert.deepEqual(app.nodes.get("#playlistContents").children.map((row) => row.children[3].textContent), ["3:00", "3:42", "1:02:03", "–", "", ""]);
});

test("the player uses known track durations when the device has not reported a length", () => {
  const app = loadApp();
  vm.runInContext('renderStatus({ Title: "Track", durationMs: 222500 })', app.context);
  assert.equal(app.nodes.get("#duration").textContent, "3:42");
  assert.equal(app.nodes.get("#seek").disabled, false);
  vm.runInContext('renderStatus({ Title: "Track", totlen: 240000, durationMs: 222500 })', app.context);
  assert.equal(app.nodes.get("#duration").textContent, "4:00", "live player duration takes precedence");
  vm.runInContext('renderStatus({ Title: "Radio", mediaType: "radio" })', app.context);
  assert.equal(app.nodes.get("#duration").textContent, "–");
  assert.equal(app.nodes.get("#seek").disabled, true);
  vm.runInContext('renderStatus({ Title: "Unknown duration" })', app.context);
  assert.equal(app.nodes.get("#duration").textContent, "–");
});

test("computer playback uses track metadata until audio duration is available", () => {
  const app = loadApp("computer");
  app.respondWith(dlnaTracks);
  vm.runInContext(`
    renderQueue(responseQueue);
    state.computerQueueIndex = 0;
    computerAudio.duration = NaN;
    renderStatus(computerAudioStatus());
  `, app.context);
  assert.equal(app.nodes.get("#duration").textContent, "3:00");
  vm.runInContext("computerAudio.duration = 222.5; renderStatus(computerAudioStatus())", app.context);
  assert.equal(app.nodes.get("#duration").textContent, "3:42");
});

test("the tonearm follows the track from the outer groove to the run-out", () => {
  const app = loadApp();
  for (const [position, angle] of [[0, "-1.5deg"], [90000, "8.25deg"], [180000, "18deg"], [240000, "18deg"], [-1000, "-1.5deg"]]) {
    vm.runInContext(`renderStatus({ status: "play", curpos: ${position}, totlen: 180000 })`, app.context);
    assert.equal(app.nodes.get("#artwork").style.getPropertyValue("--tonearm-angle"), angle);
    assert.equal(app.nodes.get("#artwork").classList.contains("has-playback"), true);
    assert.equal(app.context.document.body.classList.contains("is-playing"), true);
  }
});

test("pausing keeps the needle on the record and stopping parks the arm", () => {
  const app = loadApp();
  vm.runInContext('renderStatus({ status: "play", curpos: 90000, totlen: 180000 })', app.context);
  vm.runInContext('renderStatus({ status: "pause", curpos: 90000, totlen: 180000 })', app.context);
  assert.equal(app.nodes.get("#artwork").style.getPropertyValue("--tonearm-angle"), "8.25deg");
  assert.equal(app.nodes.get("#artwork").classList.contains("has-playback"), true);
  assert.equal(app.context.document.body.classList.contains("is-playing"), false);

  vm.runInContext('renderStatus({ status: "stop", curpos: 90000, totlen: 180000 })', app.context);
  assert.equal(app.nodes.get("#artwork").style.getPropertyValue("--tonearm-angle"), "-24deg");
  assert.equal(app.nodes.get("#artwork").classList.contains("has-playback"), false);
  assert.equal(app.context.document.body.classList.contains("is-playing"), false);
});

test("radio and tracks with unknown duration keep the needle at the outer groove", () => {
  const app = loadApp();
  vm.runInContext('renderStatus({ status: "play", mediaType: "radio", curpos: 90000, totlen: 180000 })', app.context);
  assert.equal(app.nodes.get("#artwork").style.getPropertyValue("--tonearm-angle"), "-1.5deg");
  vm.runInContext('renderStatus({ status: "play", curpos: 90000 })', app.context);
  assert.equal(app.nodes.get("#artwork").style.getPropertyValue("--tonearm-angle"), "-1.5deg");
});

test("seeking previews the needle position without a status refresh moving it back", () => {
  const app = loadApp();
  vm.runInContext('renderStatus({ status: "play", curpos: 0, totlen: 180000 })', app.context);
  const seek = app.nodes.get("#seek");
  seek.value = "90000";
  seek.listeners.input({ target: seek });
  assert.equal(app.nodes.get("#artwork").style.getPropertyValue("--tonearm-angle"), "8.25deg");
  vm.runInContext('renderStatus({ status: "play", curpos: 1000, totlen: 180000 })', app.context);
  assert.equal(app.nodes.get("#artwork").style.getPropertyValue("--tonearm-angle"), "8.25deg");
});

test("changing computer playback source stops the record and parks the arm", () => {
  const app = loadApp("computer");
  vm.runInContext('renderStatus({ status: "play", curpos: 90000, totlen: 180000 }); clearComputerTrackHighlight()', app.context);
  assert.equal(app.nodes.get("#artwork").style.getPropertyValue("--tonearm-angle"), "-24deg");
  assert.equal(app.nodes.get("#artwork").classList.contains("has-playback"), false);
  assert.equal(app.context.document.body.classList.contains("is-playing"), false);
});

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
