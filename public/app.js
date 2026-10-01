const $ = (selector) => document.querySelector(selector);
const t = (key, params) => I18n.t(key, params);
const state = {
  playing: false,
  muted: false,
  deviceLoaded: false,
  deviceLoading: false,
  seeking: false,
  volumeChanging: false,
  toneChanging: false,
  artworkKey: "",
  currentTrack: null,
  currentTrackUri: "",
  currentRadioId: "",
  currentMedia: null,
  queue: null,
  selections: new Map(),
  selectionsInitialized: false,
  selectionsEdited: false,
  config: null,
  search: { query: "", page: 1 },
  folderSearch: { query: "", page: 1 },
  libraryMode: "search",
  browseStack: [],
  spotify: { configured: false, connected: false },
  spotifySearch: { query: "" },
  spotifyDevices: [],
  computerSpotifyDeviceId: "",
  playbackTarget: "ieast",
  computerSource: null,
  computerQueueIndex: -1,
  computerQueueItemId: "",
  computerStatus: null,
  computerVolume: 0.5,
  computerMuted: false,
};
let toastTimer;
const toneTimers = {};
let selectionSyncTimer;
let selectionSyncChain = Promise.resolve();
let statusRefreshing = false;
let computerQueueAdvancing = false;
let queueScrollItemId = "";
let computerPlaybackGeneration = 0;
let playbackSourceGeneration = 0;
let playbackTargetGeneration = 0;
let playbackRequestGeneration = 0;
let spotifyManualPausePending = false;
let spotifyResumePending = false;
let computerSourceSwitchChain = Promise.resolve();
const computerAudio = new Audio();
const computerPlaybackChannel = typeof BroadcastChannel === "function"
  ? new BroadcastChannel("ieast-computer-playback")
  : null;
const computerPlaybackOwner = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
let computerPlaybackClaim = { time: 0, owner: "" };

function storedTheme() {
  try {
    const theme = localStorage.getItem("ieast-theme");
    return ["light", "dark"].includes(theme) ? theme : null;
  } catch {
    return null;
  }
}

function storedPlaybackTarget() {
  try {
    return localStorage.getItem("ieast-playback-target") === "computer" ? "computer" : "ieast";
  } catch {
    return "ieast";
  }
}

function applyTheme(value) {
  const theme = value === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  $("meta[name='theme-color']").content = theme === "light" ? "#f4f1e8" : "#11100e";
  $("#themeToggle").ariaLabel = t(theme === "light" ? "theme.switchToDark" : "theme.switchToLight");
  $("#themeToggle").setAttribute("aria-pressed", String(theme === "light"));
  try {
    localStorage.setItem("ieast-theme", theme);
  } catch {
    // The server setting still persists the theme when local storage is unavailable.
  }
  return theme;
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function decodeMetadata(value) {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return value;
  const bytes = Uint8Array.from(value.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
  const decoded = new TextDecoder().decode(bytes).trim();
  if (decoded.includes("\uFFFD") || !decoded) return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = decoded;
  return textarea.value;
}

function trackIdentity(title, artist = "") {
  const normalize = (value) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
  return `${normalize(String(title || "").replace(/^\d+\.\s+/, ""))}\n${normalize(artist)}`;
}

function updateTrackHighlights() {
  document.querySelectorAll(".search-result[data-track]").forEach((row) => {
    const current = row.dataset.track === state.currentTrack
      && (!row.dataset.spotifyUri || row.dataset.spotifyUri === state.currentTrackUri);
    const active = state.playing && current;
    row.classList.toggle("is-current", current);
    if (current) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
    const button = row.querySelector(".result-play");
    if (button) {
      button.dataset.action = active ? "pause" : "play";
      button.ariaLabel = active ? t("player.pause") : t("player.playItem", { title: button.dataset.title });
      button.innerHTML = active
        ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
    }
  });
}

function setCurrentTrack(title, artist, playing = true, spotifyUri = "") {
  state.currentTrack = title ? trackIdentity(title, artist) : null;
  state.currentTrackUri = spotifyUri;
  state.playing = playing;
  updateTrackHighlights();
}

function isCurrentResultPlaying(row) {
  return state.playing
    && row.dataset.track === state.currentTrack
    && (!row.dataset.spotifyUri || row.dataset.spotifyUri === state.currentTrackUri);
}

function updateRadioButtons() {
  document.querySelectorAll(".radio-item[data-radio-id]").forEach((row) => {
    const button = row.querySelector(".result-play");
    if (!button) return;
    const active = state.playing && row.dataset.radioId === state.currentRadioId;
    button.dataset.action = active ? "pause" : "play";
    button.ariaLabel = active ? t("player.pause") : t("player.playItem", { title: button.dataset.title });
    button.innerHTML = active
      ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
  });
}

function clearCurrentRadio() {
  state.currentRadioId = "";
  updateRadioButtons();
}

function clearComputerTrackHighlight({ preserveStatus = false } = {}) {
  if (!preserveStatus) state.computerStatus = null;
  state.currentRadioId = "";
  setCurrentTrack("", "", false);
  updateRadioButtons();
  document.body.classList.remove("is-playing");
  $("#playButton").dataset.action = "play";
  $("#playButton").ariaLabel = t("player.play");
}

function setRange(range, value, max = Number(range.max)) {
  const min = Number(range.min) || 0;
  range.value = value;
  range.style.setProperty("--value", `${max > min ? ((value - min) / (max - min)) * 100 : 0}%`);
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function resetArtwork() {
  state.artworkKey = "";
  $("#artwork").classList.remove("has-cover");
  $("#cover").hidden = true;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(I18n.error(data));
  return data;
}

async function command(action, value) {
  try {
    if (state.playbackTarget === "computer") {
      await computerCommand(action, value);
      refreshComputerStatus();
      return true;
    }
    await request("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, value }),
    });
    setTimeout(refreshStatus, 250);
    return true;
  } catch (error) {
    notify(error.message);
    return false;
  }
}

function spotifyDevice() {
  return state.playbackTarget === "computer"
    ? state.computerSpotifyDeviceId || $("#spotifyDevice").value
    : $("#spotifyDevice").value;
}

function computerAudioStatus() {
  const item = state.computerQueueIndex >= 0 ? state.queue?.items[state.computerQueueIndex] : state.computerStatus;
  return {
    status: computerAudio.paused ? "pause" : "play",
    Title: item?.title || "",
    Artist: item?.artist || "",
    Album: item?.album || "",
    artwork: item?.artwork || null,
    serverId: item?.serverId || "",
    parentId: item?.parentId || "",
    radioId: item?.radioId || item?.id || "",
    mediaType: item?.mediaType || (Number.isFinite(computerAudio.duration) ? "track" : "radio"),
    curpos: Number.isFinite(computerAudio.currentTime) ? computerAudio.currentTime * 1000 : 0,
    totlen: Number.isFinite(computerAudio.duration) ? computerAudio.duration * 1000 : 0,
    vol: Math.round(computerAudio.volume * 100),
    mute: computerAudio.muted ? 1 : 0,
  };
}

function refreshComputerStatus() {
  if (state.playbackTarget !== "computer") return;
  if (state.computerSource === "audio") renderStatus(computerAudioStatus());
  else if (state.computerStatus) renderStatus(state.computerStatus);
  else renderStatus({ status: "stop", vol: Math.round(state.computerVolume * 100) });
  if (state.queue) renderQueue(state.queue);
}

function computerCommand(action, value) {
  if (!["play", "pause"].includes(action)) return computerCommandNow(action, value);
  const targetGeneration = playbackTargetGeneration;
  const requestGeneration = ++playbackRequestGeneration;
  computerPlaybackGeneration += 1;
  if (action === "play") claimComputerPlayback();
  else computerAudio.pause();
  return switchComputerSource(() => {
    if (requestGeneration !== playbackRequestGeneration
      || targetGeneration !== playbackTargetGeneration || state.playbackTarget !== "computer") return;
    return computerCommandNow(action, value);
  });
}

async function computerCommandNow(action, value) {
  if (action === "play" && !state.computerSource && state.queue?.items.length) {
    const index = state.computerQueueIndex >= 0 ? state.computerQueueIndex : Math.max(0, state.queue.index);
    await playComputerQueueIndexNow(index);
    return;
  }
  if (action === "next" && state.computerQueueIndex >= 0) {
    await advanceComputerQueue();
    return;
  }
  if (action === "prev" && state.computerQueueIndex >= 0) {
    if (state.computerSource === "audio" && computerAudio.currentTime > 3) computerAudio.currentTime = 0;
    else await playComputerQueueIndex(Math.max(0, state.computerQueueIndex - 1));
    return;
  }
  if (state.computerSource === "spotify-connect") {
    if (action === "pause") {
      spotifyManualPausePending = true;
      spotifyResumePending = false;
      computerPlaybackGeneration += 1;
    } else if (action === "play") {
      spotifyResumePending = true;
      computerPlaybackGeneration += 1;
    }
    let commandValue = value;
    if (action === "mute") {
      state.computerMuted = true;
      commandValue = 0;
    } else if (action === "unmute") {
      state.computerMuted = false;
      commandValue = Math.round((state.computerVolume || 0.5) * 100);
    } else if (action === "volume") {
      state.computerVolume = value / 100;
      state.computerMuted = false;
    }
    try {
      await request("/api/spotify/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, value: commandValue, deviceId: spotifyDevice() }),
      });
    } catch (error) {
      if (action === "pause" || action === "play") {
        spotifyManualPausePending = false;
        spotifyResumePending = false;
      }
      throw error;
    }
    return;
  }
  if (action === "play") await computerAudio.play();
  else if (action === "pause") computerAudio.pause();
  else if (action === "seek") computerAudio.currentTime = value / 1000;
  else if (action === "mute" || action === "unmute") {
    state.computerMuted = action === "mute";
    computerAudio.muted = state.computerMuted;
  }
  else if (action === "volume") {
    state.computerVolume = value / 100;
    state.computerMuted = false;
    computerAudio.muted = false;
    computerAudio.volume = state.computerVolume;
  }
}

function renderToneValue(name, value) {
  const numericValue = Number(value);
  setRange($(`#${name}`), numericValue);
  $(`#${name}Value`).textContent = numericValue > 0 ? `+${numericValue}` : String(numericValue);
}

async function setTone(action, value) {
  try {
    const tone = await request("/api/tone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, value }),
    });
    renderToneValue("bass", tone.bass);
    renderToneValue("treble", tone.treble);
  } catch (error) {
    notify(error.message);
    loadTone();
  } finally {
    state.toneChanging = false;
  }
}

async function loadTone() {
  try {
    const tone = await request("/api/tone");
    if (state.toneChanging) return;
    renderToneValue("bass", tone.bass);
    renderToneValue("treble", tone.treble);
  } catch (error) {
    notify(error.message);
  }
}

function renderQueue(data, selectionEntries = null) {
  if (state.playbackTarget === "computer" && state.computerQueueItemId) {
    const currentIndex = data.items.findIndex((item) => item.queueItemId === state.computerQueueItemId);
    if (currentIndex >= 0) state.computerQueueIndex = currentIndex;
    else {
      state.computerQueueIndex = -1;
      state.computerQueueItemId = "";
    }
  }
  if (state.playbackTarget === "computer") {
    data = state.computerQueueIndex >= 0
      ? {
        ...data,
        index: state.computerQueueIndex,
        state: state.playing ? "playing" : state.computerSource ? "paused" : "stopped",
      }
      : { ...data, index: -1, state: "stopped" };
  }
  state.queue = data;
  $("#queueAutoNext").checked = data.options.autoNext;
  $("#queueContinueAlbums").checked = data.options.continueAlbums;
  $("#shuffleQueue").disabled = data.items.length < 2;
  $("#resetQueueOrder").disabled = !data.originalItems;
  $("#queueSummary").textContent = data.items.length
    ? t("queue.summary", {
      current: Math.max(0, data.index + 1),
      count: data.items.length,
      state: t(`queue.state.${data.state === "playing" ? "playing" : data.state === "paused" ? "paused" : "stopped"}`),
    })
    : t("queue.empty");
  const queueList = $("#queueList");
  queueList.replaceChildren(...data.items.map((item, index) => {
    const row = document.createElement("li");
    row.classList.toggle("current", index === data.index);
    const cover = document.createElement("span");
    cover.className = "queue-cover";
    if (item.artwork) {
      const image = document.createElement("img");
      image.src = item.artwork;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => image.remove(), { once: true });
      cover.append(image);
    }
    const number = document.createElement("span");
    number.className = "queue-number";
    number.textContent = String(index + 1);
    const title = document.createElement("strong");
    const displayTitle = item.titleMissing || item.title === "Ukendt titel" ? t("common.unknownTitle") : item.title;
    title.textContent = displayTitle;
    const artist = document.createElement("span");
    artist.textContent = item.artist || t("common.unknownArtist");
    const album = document.createElement("span");
    album.className = "queue-item-album";
    album.textContent = item.album || t("common.unknownAlbum");
    const play = document.createElement("button");
    play.className = "queue-play";
    play.type = "button";
    const isCurrent = index === data.index;
    const isPlaying = isCurrent && data.state === "playing";
    play.classList.toggle("is-pause", isPlaying);
    play.ariaLabel = isPlaying
      ? t("player.pauseItem", { title: displayTitle })
      : isCurrent && data.state === "paused"
        ? t("player.resumeItem", { title: displayTitle })
        : t("player.playItem", { title: displayTitle });
    play.innerHTML = isPlaying
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>';
    play.addEventListener("click", async () => {
      play.disabled = true;
      try {
        const currentIndex = state.playbackTarget === "computer" ? state.computerQueueIndex : state.queue?.index;
        const currentState = state.playbackTarget === "computer"
          ? state.playing ? "playing" : state.computerSource ? "paused" : "stopped"
          : state.queue?.state;
        if (index === currentIndex && ["playing", "paused"].includes(currentState)) {
          await command(currentState === "playing" ? "pause" : "play");
          await loadQueue();
        } else if (state.playbackTarget === "computer") {
          await playComputerQueueIndex(index);
        } else {
          const queue = await request("/api/queue/play-index", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index, deviceId: item.type === "spotify" ? spotifyDevice() : undefined }),
          });
          clearCurrentRadio();
          renderQueue(queue);
        }
        setTimeout(refreshStatus, 500);
      } catch (error) {
        notify(error.message);
      } finally {
        play.disabled = false;
      }
    });
    row.append(cover, number, title, artist, album, play);
    return row;
  }));
  const currentItem = data.items[data.index];
  const currentItemId = currentItem?.queueItemId ? `${currentItem.queueItemId}:${data.index}` : "";
  if (currentItemId !== queueScrollItemId) {
    queueScrollItemId = currentItemId;
    const currentRow = queueList.querySelector("li.current");
    if (currentRow) requestAnimationFrame(() => {
      if (!currentRow.isConnected || queueScrollItemId !== currentItemId) return;
      const listRect = queueList.getBoundingClientRect();
      const rowRect = currentRow.getBoundingClientRect();
      queueList.scrollTo({
        top: queueList.scrollTop + rowRect.top - listRect.top - (queueList.clientHeight - currentRow.offsetHeight) / 2,
        behavior: "smooth",
      });
    });
  }
  const selected = $("#savedPlaylist").value;
  const options = data.playlists.map((playlist) => {
    const option = document.createElement("option");
    option.value = playlist.id;
    option.textContent = `${playlist.name} · ${playlist.entries.length}`;
    return option;
  });
  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("playlists.none");
    options.push(option);
  }
  $("#savedPlaylist").replaceChildren(...options);
  if (data.playlists.some((playlist) => playlist.id === selected)) $("#savedPlaylist").value = selected;
  renderPlaylistContents();
  if (selectionEntries) {
    selectPlaylistEntries(selectionEntries);
  } else if (!state.selectionsInitialized) {
    const entries = data.items.map((track) => track.type === "spotify"
      ? { type: "spotifyTrack", track }
      : { type: "track", serverId: track.serverId, track });
    if (entries.length) selectPlaylistEntries(entries);
    else if (data.playlists[0]) selectPlaylistEntries(data.playlists[0].entries);
    state.selectionsInitialized = true;
  }
}

function renderPlaylistContents() {
  const playlist = state.queue?.playlists.find((item) => item.id === $("#savedPlaylist").value);
  $("#updatePlaylist").disabled = !playlist;
  $("#deletePlaylist").disabled = !playlist;
  $("#playPlaylist").disabled = !playlist;
  $("#playlistSummary").textContent = playlist
    ? t("playlists.entryCount", { count: playlist.entries.length })
    : t("playlists.none");
  $("#playlistContents").replaceChildren(...(playlist?.entries || []).map((entry, index) => {
    const row = document.createElement("li");
    const number = document.createElement("span");
    number.textContent = String(index + 1);
    const type = document.createElement("small");
    type.textContent = t(["album", "spotifyAlbum"].includes(entry.type) ? "common.album" : "common.track");
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = ["album", "spotifyAlbum"].includes(entry.type)
      ? entry.album || t("common.unknownAlbum")
      : entry.track?.title || entry.title || t("common.unknownTrack");
    const subtitle = document.createElement("span");
    subtitle.textContent = ["album", "spotifyAlbum"].includes(entry.type)
      ? t("playlists.wholeAlbum")
      : [entry.track?.artist || entry.artist, entry.track?.album || entry.album].filter(Boolean).join(" · ");
    details.append(title, subtitle);
    row.append(number, type, details);
    return row;
  }));
}

async function loadQueue() {
  try {
    renderQueue(await request("/api/queue"));
  } catch {
    // Player status remains usable if queue state cannot be loaded.
  }
}

async function ensureSpotifyComputerDevice() {
  await loadSpotifyDevices();
  const selected = state.spotifyDevices.find((device) => device.id === $("#spotifyDevice").value && device.type?.toLowerCase() === "computer");
  const device = selected || state.spotifyDevices.find((item) => item.type?.toLowerCase() === "computer");
  if (!device) throw new Error(t("spotify.openDesktop"));
  $("#spotifyDevice").value = device.id;
  state.computerSpotifyDeviceId = device.id;
  return device.id;
}

async function pauseSpotifyComputer() {
  const deviceId = state.computerSpotifyDeviceId || spotifyDevice();
  if (state.computerSource !== "spotify-connect" || !deviceId) return;
  await pauseSpotifyDevice(deviceId);
}

async function pauseSpotifyDevice(deviceId) {
  await request("/api/spotify/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "pause", deviceId }),
  });
}

function switchComputerSource(operation) {
  const next = computerSourceSwitchChain.then(operation, operation);
  computerSourceSwitchChain = next.catch(() => {});
  return next;
}

function claimComputerPlayback() {
  computerPlaybackClaim = {
    time: Math.max(Date.now(), computerPlaybackClaim.time + 1),
    owner: computerPlaybackOwner,
  };
  computerPlaybackChannel?.postMessage({ type: "play", ...computerPlaybackClaim });
}

function startPlayback(operation) {
  const requestGeneration = ++playbackRequestGeneration;
  const targetGeneration = playbackTargetGeneration;
  const target = state.playbackTarget;
  const isCurrent = () => requestGeneration === playbackRequestGeneration
    && targetGeneration === playbackTargetGeneration && target === state.playbackTarget;
  if (target === "computer") {
    computerPlaybackGeneration += 1;
    claimComputerPlayback();
    computerAudio.pause();
  }
  return switchComputerSource(() => {
    if (!isCurrent()) return false;
    return operation({ target, targetGeneration, isCurrent });
  });
}

async function prepareSpotifyComputerPlayback() {
  const replacingAudio = state.computerSource === "audio";
  if (replacingAudio) {
    state.computerSource = null;
    computerAudio.pause();
    clearComputerTrackHighlight();
  }
  const deviceId = await ensureSpotifyComputerDevice();
  if (!replacingAudio) clearComputerTrackHighlight();
  state.computerSource = "spotify-connect";
  return deviceId;
}

async function playComputerQueueIndexNow(index, targetGeneration = playbackTargetGeneration) {
  const item = state.queue?.items[index];
  if (!item) return;
  const playbackGeneration = ++computerPlaybackGeneration;
  const isCurrent = () => playbackGeneration === computerPlaybackGeneration
    && targetGeneration === playbackTargetGeneration && state.playbackTarget === "computer";
  spotifyManualPausePending = false;
  spotifyResumePending = false;
  state.computerQueueIndex = index;
  state.computerQueueItemId = item.queueItemId;
  if (item.type === "spotify") {
    const deviceId = await prepareSpotifyComputerPlayback();
    if (!isCurrent()) return;
    state.queue = await request("/api/queue/play-index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index, deviceId, singleSpotify: true }),
    });
    if (!isCurrent()) {
      await pauseSpotifyDevice(deviceId).catch(() => null);
      return;
    }
  } else {
    await pauseSpotifyComputer();
    if (!isCurrent()) return;
    computerAudio.pause();
    state.computerSource = null;
    clearComputerTrackHighlight();
    state.computerSource = "audio";
    state.computerStatus = item;
    computerAudio.src = `/api/local-media/queue/${encodeURIComponent(item.queueItemId)}`;
    computerAudio.muted = state.computerMuted;
    computerAudio.volume = state.computerVolume;
    void computerAudio.play().catch((error) => {
      if (isCurrent()) notify(error.message);
    });
  }
  refreshComputerStatus();
}

function playComputerQueueIndex(index) {
  return startPlayback(({ targetGeneration }) => {
    if (state.playbackTarget !== "computer") return;
    return playComputerQueueIndexNow(index, targetGeneration);
  });
}

async function advanceComputerQueue() {
  if (!state.queue || computerQueueAdvancing) return;
  computerQueueAdvancing = true;
  try {
    let nextIndex = state.computerQueueIndex + 1;
    if (nextIndex >= state.queue.items.length && state.queue.options.continueAlbums) {
      state.queue = await request("/api/queue/extend", { method: "POST" });
    }
    nextIndex = state.computerQueueIndex + 1;
    if (nextIndex < state.queue.items.length) {
      await playComputerQueueIndex(nextIndex);
    } else {
      state.computerStatus = { ...state.computerStatus, status: "stop", curpos: state.computerStatus?.totlen || 0 };
      state.computerSource = null;
      state.playing = false;
      refreshComputerStatus();
    }
  } finally {
    computerQueueAdvancing = false;
  }
}

computerPlaybackChannel?.addEventListener("message", (event) => {
  const claim = event.data;
  if (claim?.type !== "play" || !Number.isFinite(claim.time) || typeof claim.owner !== "string") return;
  if (claim.time < computerPlaybackClaim.time
    || (claim.time === computerPlaybackClaim.time && claim.owner <= computerPlaybackClaim.owner)) return;
  computerPlaybackClaim = { time: claim.time, owner: claim.owner };
  playbackRequestGeneration += 1;
  computerPlaybackGeneration += 1;
  computerAudio.pause();
  refreshComputerStatus();
});
computerAudio.addEventListener("play", refreshComputerStatus);
computerAudio.addEventListener("pause", refreshComputerStatus);
computerAudio.addEventListener("loadedmetadata", refreshComputerStatus);
computerAudio.addEventListener("ended", () => {
  if (state.computerQueueIndex >= 0 && state.queue?.options.autoNext) advanceComputerQueue().catch((error) => notify(error.message));
  else refreshComputerStatus();
});
computerAudio.addEventListener("error", () => notify(computerAudio.error?.message || t("connection.offline")));

function updateSelectionSummary() {
  const count = state.selections.size;
  $("#selectionSummary").textContent = count ? t("selection.count", { count }) : t("selection.none");
  $("#playSelection").disabled = !count;
  $("#appendSelection").disabled = !count;
}

async function syncSelectionToQueue() {
  try {
    const entries = [...state.selections.values()];
    const data = entries.length
      ? await request("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, play: false, shuffle: false }),
      })
      : await request("/api/queue", { method: "DELETE" });
    renderQueue(data);
  } catch (error) {
    notify(error.message);
  }
}

function scheduleSelectionSync() {
  clearTimeout(selectionSyncTimer);
  selectionSyncTimer = setTimeout(() => {
    selectionSyncChain = selectionSyncChain.then(syncSelectionToQueue);
  }, 250);
}

function selectionCheckbox(label, key, entry) {
  const wrapper = document.createElement("label");
  wrapper.className = "column-check";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.selectionKey = key;
  checkbox.checked = state.selections.has(key);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selections.set(key, entry);
    else state.selections.delete(key);
    state.selectionsEdited = true;
    updateSelectionSummary();
    scheduleSelectionSync();
  });
  const text = document.createElement("span");
  text.className = "sr-only";
  text.textContent = label;
  const indicator = document.createElement("b");
  indicator.className = "toggle-state";
  wrapper.append(checkbox, text, indicator);
  return wrapper;
}

function selectionEntryKey(entry) {
  if (entry.type === "album") return `album:${entry.serverId}:${entry.albumId || entry.album}`;
  if (entry.type === "spotifyAlbum") return `spotify-album:${entry.uri}`;
  if (entry.type === "spotifyTrack") return `spotify-track:${entry.track?.uri || entry.uri}`;
  const track = entry.track || entry;
  return `track:${entry.serverId || track.serverId}:${track.objectId || track.id || track.url}`;
}

function selectPlaylistEntries(entries) {
  clearTimeout(selectionSyncTimer);
  state.selections = new Map(entries.map((entry) => [selectionEntryKey(entry), entry]));
  state.selectionsInitialized = true;
  state.selectionsEdited = false;
  document.querySelectorAll("input[data-selection-key]").forEach((checkbox) => {
    checkbox.checked = state.selections.has(checkbox.dataset.selectionKey);
  });
  updateSelectionSummary();
}

function trackQueueEntry(item) {
  return { type: "track", serverId: $("#mediaServer").value, track: { ...item, objectId: item.id, serverId: $("#mediaServer").value } };
}

function albumQueueEntry(item) {
  return { type: "album", serverId: $("#mediaServer").value, albumId: item.parentId, album: item.album };
}

function spotifyTrackQueueEntry(item) {
  return {
    type: "spotifyTrack",
    track: {
      uri: item.uri, title: item.title, artist: item.subtitle, album: item.detail,
      artwork: item.artwork, durationMs: item.durationMs, track: item.track,
    },
  };
}

function spotifyAlbumQueueEntry(item) {
  return { type: "spotifyAlbum", uri: item.albumUri || item.uri, album: item.detail || item.title, artist: item.subtitle, artwork: item.artwork };
}

function folderQueueEntry(folder) {
  return { type: "album", serverId: $("#mediaServer").value, albumId: folder.id, albumParentId: folder.parentId, album: folder.title };
}

async function updateArtwork(title, artist, sourceUrl) {
  const key = `${artist}\n${title}\n${sourceUrl || ""}`;
  if (key === state.artworkKey) return;
  state.artworkKey = key;
  const artwork = $("#artwork");
  const cover = $("#cover");
  artwork.classList.remove("has-cover");
  try {
    let url = sourceUrl;
    if (!url) {
      const lookupArtist = state.config?.mediaServers.some((server) => server.name === artist) ? "" : artist;
      const params = new URLSearchParams({ title, artist: lookupArtist });
      url = (await request(`/api/artwork?${params}`)).url;
    }
    if (state.artworkKey !== key || !url) return;
    cover.onload = () => artwork.classList.add("has-cover");
    cover.src = url;
    cover.alt = t("player.coverAlt", { title });
    cover.hidden = false;
  } catch {
    cover.hidden = true;
  }
}

function renderStatus(data) {
  state.playing = data.status === "play" || data.status === "playing";
  state.currentRadioId = data.mediaType === "radio" ? String(data.radioId || data.id || "") : "";
  state.muted = data.mute === "1" || data.mute === 1;
  document.body.classList.toggle("is-playing", state.playing);
  document.body.classList.toggle("is-muted", state.muted);
  $("#playButton").dataset.action = state.playing ? "pause" : "play";
  $("#playButton").ariaLabel = t(state.playing ? "player.pause" : "player.play");
  $("#muteButton").ariaLabel = t(state.muted ? "player.unmute" : "player.mute");

  const placeholder = data.metadataPlaceholder === "external-playback";
  const rawTitle = placeholder ? "" : decodeMetadata(data.Title || data.title) || "";
  const rawArtist = placeholder ? "" : decodeMetadata(data.Artist || data.artist || data.Album) || "";
  const hasTitle = Boolean(rawTitle);
  const title = placeholder ? t("player.externalPlayback") : rawTitle || t("player.ready");
  const artist = placeholder ? t("player.metadataPrompt") : rawArtist || t("player.choose");
  const album = decodeMetadata(data.Album || data.album) || "";
  state.currentMedia = {
    title: rawTitle,
    artist: rawArtist,
    album,
    albumUri: data.albumUri || "",
    spotifyUri: data.spotifyUri || "",
    serverId: data.serverId || "",
    parentId: data.parentId || "",
    folderTitle: data.folderTitle || album || "",
  };
  setCurrentTrack(rawTitle, rawArtist, state.playing, data.spotifyUri || "");
  updateRadioButtons();
  $("#title").textContent = title;
  $("#title").disabled = !hasTitle;
  $("#artist").textContent = artist;
  $("#albumRow").hidden = !album;
  $("#album").textContent = album;
  $("#album").disabled = !album;
  if (data.disableArtwork) resetArtwork();
  else if (hasTitle) updateArtwork(rawTitle, rawArtist, data.artwork);
  $("#source").textContent = t(data.status === "stop" ? "player.streamer" : "player.nowPlaying");

  const duration = Number(data.totlen) || 0;
  const isRadio = data.mediaType === "radio" || !duration;
  const position = isRadio ? 0 : Math.min(Number(data.curpos) || 0, duration);
  const tonearmProgress = isRadio ? 0 : Math.min(1, position / duration);
  $("#artwork").style.setProperty("--tonearm-angle", `${-18 + tonearmProgress * 18}deg`);
  $("#seek").disabled = isRadio;
  if (!state.seeking) {
    $("#seek").max = duration || 1;
    setRange($("#seek"), position, duration || 1);
    $("#currentTime").textContent = formatTime(position);
  }
  $("#duration").textContent = formatTime(duration);

  if (!state.volumeChanging) {
    const volume = Math.min(100, Math.max(0, Number(data.vol) || 0));
    setRange($("#volume"), volume, 100);
    $("#volumeValue").textContent = volume;
  }
}

async function refreshStatus() {
  if (statusRefreshing) return;
  statusRefreshing = true;
  const sourceGeneration = playbackSourceGeneration;
  const targetGeneration = playbackTargetGeneration;
  const playbackTarget = state.playbackTarget;
  try {
    if (state.playbackTarget === "computer") {
      const queue = await request("/api/queue").catch(() => null);
      if (sourceGeneration !== playbackSourceGeneration
        || targetGeneration !== playbackTargetGeneration
        || playbackTarget !== state.playbackTarget) return;
      if (state.computerSource === "spotify-connect" && spotifyDevice()) {
        const playbackGeneration = computerPlaybackGeneration;
        const queueItemId = state.computerQueueItemId;
        const playback = await request(`/api/spotify/playback?deviceId=${encodeURIComponent(spotifyDevice())}`).catch(() => null);
        if (sourceGeneration !== playbackSourceGeneration
          || targetGeneration !== playbackTargetGeneration
          || playbackTarget !== state.playbackTarget) return;
        if (playbackGeneration === computerPlaybackGeneration && state.playbackTarget === "computer" && state.computerSource === "spotify-connect" && state.computerQueueItemId === queueItemId && playback?.active) {
          const previous = state.computerStatus;
          const currentItem = state.queue?.items[state.computerQueueIndex];
          const suppressPause = spotifyManualPausePending || spotifyResumePending;
          const ended = state.queue?.options.autoNext
            && !suppressPause
            && previous?.status === "play"
            && previous.spotifyUri === currentItem?.uri
            && playback.status === "pause"
            && playback.spotifyUri === currentItem.uri
            && (Number(playback.curpos) === 0 || Number(playback.totlen) - Number(playback.curpos) <= 250);
          state.computerStatus = playback;
          if (!playback.mute) state.computerVolume = playback.vol / 100;
          if (playback.status === "play" && spotifyResumePending) {
            spotifyManualPausePending = false;
            spotifyResumePending = false;
          } else if (spotifyManualPausePending && !spotifyResumePending) {
            spotifyManualPausePending = false;
          }
          if (ended) advanceComputerQueue().catch((error) => notify(error.message));
        }
      }
      if (queue) state.queue = queue;
      refreshComputerStatus();
      $("#connection").className = "connection online";
      $("#connectionText").textContent = t("player.computerReady");
      return;
    }
    const data = await request("/api/status");
    const [tone, queue] = await Promise.all([
      request("/api/tone").catch(() => null),
      request("/api/queue").catch(() => null),
    ]);
    if (sourceGeneration !== playbackSourceGeneration
      || targetGeneration !== playbackTargetGeneration
      || playbackTarget !== state.playbackTarget) return;
    renderStatus(data);
    if (tone && !state.toneChanging) {
      renderToneValue("bass", tone.bass);
      renderToneValue("treble", tone.treble);
    }
    if (queue) renderQueue(queue);
    $("#connection").className = "connection online";
    $("#connectionText").textContent = t("connection.connected");
    if (!state.deviceLoaded) loadDevice();
  } catch (error) {
    $("#connection").className = "connection offline";
    $("#connectionText").textContent = t("connection.offline");
  } finally {
    statusRefreshing = false;
  }
}

async function loadDevice() {
  if (state.deviceLoading) return;
  state.deviceLoading = true;
  try {
    const data = await request("/api/device");
    $("#deviceName").textContent = data.name || t("product.ieast");
    $("#deviceIp").textContent = data.ip;
    $("#firmware").textContent = data.firmware || "–";
    $("#signal").textContent = Number.isFinite(data.signal) ? `${data.signal} dBm` : "–";
    document.title = t("app.title");
    state.deviceLoaded = true;
  } catch {
    // The status poll displays connection errors; device details can remain blank.
  } finally {
    state.deviceLoading = false;
  }
}

async function saveConfiguration(nextConfig) {
  const savedConfig = await request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextConfig),
  });
  state.config = { ...nextConfig, ...savedConfig };
  if (!["light", "dark"].includes(savedConfig.theme)) state.config.theme = nextConfig.theme;
  renderConfiguration();
  return state.config;
}

function renderConfiguration() {
  const selected = $("#mediaServer").value;
  const servers = state.config?.mediaServers || [];
  $("#mediaServer").replaceChildren(...servers.map((server) => {
    const option = document.createElement("option");
    option.value = server.id;
    option.textContent = server.name;
    return option;
  }));
  if (servers.some((server) => server.id === selected)) $("#mediaServer").value = selected;
  $("#mediaServer").disabled = servers.length === 0;
  $("#libraryName").textContent = state.libraryMode === "spotify"
    ? t("spotify.nameUpper")
    : servers.find((server) => server.id === $("#mediaServer").value)?.name || t("common.noServer");
  renderRadios();
}

async function loadConfiguration() {
  try {
    state.config = await request("/api/config");
    I18n.setLocale(state.config.language);
    I18n.apply();
    state.config.theme = applyTheme(storedTheme() || state.config.theme);
    $("#themeToggle").disabled = false;
    renderConfiguration();
    const params = new URLSearchParams(location.search);
    if (params.has("spotify") || params.has("spotifyError") || params.has("spotifyErrorCode")) {
      setLibraryMode("spotify");
      const spotifyError = I18n.spotifyError(params.get("spotifyErrorCode"), params.get("spotifyError"));
      notify(spotifyError || t("spotify.connected"));
      history.replaceState({}, "", location.pathname);
    }
  } catch (error) {
    notify(error.message);
  }
}

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => command(button.dataset.action));
});

$("#playbackTarget").addEventListener("change", async (event) => {
  const previous = state.playbackTarget;
  state.playbackTarget = event.target.value;
  playbackTargetGeneration += 1;
  const targetGeneration = playbackTargetGeneration;
  computerPlaybackGeneration += 1;
  spotifyManualPausePending = false;
  spotifyResumePending = false;
  try {
    localStorage.setItem("ieast-playback-target", state.playbackTarget);
  } catch {
    // Playback still works for this session when local storage is unavailable.
  }
  $(".tone-controls").hidden = state.playbackTarget === "computer";
  $("#spotifyDevice").hidden = state.libraryMode !== "spotify" || !state.spotify.connected;
  if (state.playbackTarget === "computer") {
    const queue = state.queue;
    if (state.computerQueueItemId && !queue?.items.some((item) => item.queueItemId === state.computerQueueItemId)) {
      state.computerSource = null;
      state.computerStatus = null;
      state.computerQueueIndex = -1;
      state.computerQueueItemId = "";
      computerAudio.pause();
    }
    if (!state.computerSource && queue?.items.length) {
      const index = queue.items[queue.index] ? queue.index : 0;
      state.computerQueueIndex = index;
      state.computerQueueItemId = queue.items[index].queueItemId;
    }
    refreshComputerStatus();
  } else {
    clearComputerTrackHighlight({ preserveStatus: true });
  }
  if (previous === "computer" && state.playbackTarget === "ieast") {
    await switchComputerSource(async () => {
      if (targetGeneration !== playbackTargetGeneration || state.playbackTarget !== "ieast") return;
      const source = state.computerSource;
      let stopped = true;
      await pauseSpotifyComputer().catch((error) => {
        stopped = false;
        notify(error.message);
      });
      if (targetGeneration !== playbackTargetGeneration || state.playbackTarget !== "ieast") return;
      if (source === "spotify-connect" && stopped && state.computerStatus) {
        state.computerStatus = { ...state.computerStatus, status: "pause" };
      }
      computerAudio.pause();
    });
  } else if (state.playbackTarget === "computer") {
    await switchComputerSource(async () => {
      if (targetGeneration !== playbackTargetGeneration || state.playbackTarget !== "computer") return;
      await request("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      }).catch(() => null);
    });
  }
  if (state.libraryMode === "spotify") loadSpotify();
  await refreshStatus();
});

$("#themeToggle").addEventListener("click", async () => {
  if (!state.config) return;
  const previous = state.config.theme;
  const next = applyTheme(previous === "light" ? "dark" : "light");
  $("#themeToggle").disabled = true;
  try {
    await saveConfiguration({ ...state.config, theme: next });
  } catch (error) {
    state.config.theme = applyTheme(previous);
    notify(error.message);
  } finally {
    $("#themeToggle").disabled = false;
  }
});

$("#muteButton").addEventListener("click", () => command(state.muted ? "unmute" : "mute"));

$("#volume").addEventListener("input", (event) => {
  state.volumeChanging = true;
  const volume = Number(event.target.value);
  setRange(event.target, volume, 100);
  $("#volumeValue").textContent = volume;
});
$("#volume").addEventListener("change", (event) => {
  state.volumeChanging = false;
  command("volume", Number(event.target.value));
});

for (const name of ["bass", "treble"]) {
  $(`#${name}`).addEventListener("input", (event) => {
    const value = Number(event.target.value);
    state.toneChanging = true;
    renderToneValue(name, value);
    clearTimeout(toneTimers[name]);
    toneTimers[name] = setTimeout(() => setTone(name, value), 180);
  });
  $(`#${name}`).addEventListener("change", (event) => {
    state.toneChanging = true;
    clearTimeout(toneTimers[name]);
    setTone(name, Number(event.target.value));
  });
}

$("#seek").addEventListener("input", (event) => {
  state.seeking = true;
  const position = Number(event.target.value);
  setRange(event.target, position, Number(event.target.max));
  $("#currentTime").textContent = formatTime(position);
});
$("#seek").addEventListener("change", (event) => {
  state.seeking = false;
  command("seek", Number(event.target.value));
});

async function playRadio(radio, button) {
  button.disabled = true;
  try {
    if (state.playbackTarget === "computer") {
      const started = await startPlayback(async ({ isCurrent }) => {
        if (!isCurrent()) return false;
        computerPlaybackGeneration += 1;
        await pauseSpotifyComputer();
        if (!isCurrent()) return false;
        state.computerSource = null;
        computerAudio.pause();
        clearComputerTrackHighlight();
        state.computerSource = "audio";
        state.computerQueueIndex = -1;
        state.computerQueueItemId = "";
        state.computerStatus = { ...radio, title: radio.name, artist: t("common.radio"), mediaType: "radio", radioId: radio.id };
        computerAudio.src = `/api/local-media/radio/${encodeURIComponent(radio.id)}`;
        computerAudio.muted = state.computerMuted;
        computerAudio.volume = state.computerVolume;
        void computerAudio.play().catch((error) => {
          if (isCurrent()) notify(error.message);
        });
        refreshComputerStatus();
        return true;
      });
      if (!started) return;
      notify(t("player.playingItem", { title: radio.name }));
      return;
    }
    const started = await startPlayback(async ({ isCurrent }) => {
      if (!isCurrent()) return false;
      await request("/api/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: radio.url,
          metadata: {
            title: radio.name,
            artist: t("common.radio"),
            artwork: radio.artwork,
            disableArtwork: !radio.artwork,
            mediaType: "radio",
            radioId: radio.id,
          },
        }),
      });
      if (!isCurrent()) {
        await request("/api/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pause" }),
        }).catch(() => null);
        return false;
      }
      playbackSourceGeneration += 1;
      state.currentMedia = { ...(state.currentMedia || {}), spotifyUri: "" };
      if (state.queue) renderQueue({ ...state.queue, index: -1, state: "stopped" });
      renderStatus({
        ...radio,
        status: "play",
        title: radio.name,
        artist: t("common.radio"),
        mediaType: "radio",
        radioId: radio.id,
        vol: Number($("#volume").value),
        mute: state.muted ? 1 : 0,
      });
      return true;
    });
    if (!started) return;
    notify(t("player.playingItem", { title: radio.name }));
    setTimeout(refreshStatus, 500);
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
}

function renderRadios() {
  const radios = [...(state.config?.radios || [])].sort((a, b) =>
    (Number(b.rating) || 0) - (Number(a.rating) || 0) || a.name.localeCompare(b.name, I18n.locale, { sensitivity: "base" })
  );
  const list = $("#radioList");
  if (!radios.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = t("radio.none");
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...radios.map((radio) => {
    const row = document.createElement("div");
    row.className = "radio-item";
    row.dataset.radioId = String(radio.id);
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = radio.name;
    const url = document.createElement("span");
    url.textContent = radio.url;
    info.append(name, url);
    const rating = document.createElement("div");
    rating.className = "radio-rating";
    rating.setAttribute("aria-label", t("radio.rating", { name: radio.name }));
    for (let value = 1; value <= 5; value += 1) {
      const star = document.createElement("button");
      star.type = "button";
      star.className = value <= (radio.rating || 0) ? "active" : "";
      star.textContent = "★";
      star.ariaLabel = t("radio.stars", { count: value });
      star.addEventListener("click", async () => {
        const nextRating = radio.rating === value ? 0 : value;
        star.disabled = true;
        try {
          const updated = state.config.radios.map((item) => item.id === radio.id ? { ...item, rating: nextRating } : item);
          await saveConfiguration({ ...state.config, radios: updated });
        } catch (error) {
          notify(error.message);
        }
      });
      rating.append(star);
    }
    const play = document.createElement("button");
    play.className = "result-play";
    play.dataset.title = radio.name;
    play.ariaLabel = t("player.playItem", { title: radio.name });
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
    play.addEventListener("click", async () => {
      if (play.dataset.action !== "pause" || state.currentRadioId !== String(radio.id) || !state.playing) {
        await playRadio(radio, play);
        return;
      }
      play.disabled = true;
      const paused = await command("pause");
      if (!paused) {
        play.disabled = false;
        return;
      }
      state.playing = false;
      updateRadioButtons();
      play.disabled = false;
    });
    row.append(info, rating, play);
    return row;
  }));
  updateRadioButtons();
}

function createTrackRow(item) {
    const row = document.createElement("article");
    row.className = "search-result";
    row.dataset.track = trackIdentity(item.title, item.artist);
    const cover = document.createElement("img");
    cover.className = "result-cover";
    if (item.artwork) cover.src = item.artwork;
    cover.alt = "";

    const details = document.createElement("div");
    details.className = "result-title";
    const title = document.createElement("strong");
    title.textContent = `${item.track ? `${item.track}. ` : ""}${item.title || t("common.unknownTitle")}`;
    const titleLine = document.createElement("div");
    titleLine.className = "result-title-line";
    titleLine.append(selectionCheckbox(t("selection.track"), `track:${$("#mediaServer").value}:${item.id || item.url}`, trackQueueEntry(item)), title);
    const artist = document.createElement("span");
    artist.textContent = item.artist || t("common.unknownArtist");
    details.append(titleLine, artist);

    const albumCell = document.createElement("div");
    albumCell.className = "album-cell";
    if (item.parentId && item.album) {
      albumCell.append(selectionCheckbox(t("selection.album"), `album:${$("#mediaServer").value}:${item.parentId}`, albumQueueEntry(item)));
    }
    const album = document.createElement("button");
    album.className = "result-album";
    album.type = "button";
    album.textContent = item.album || "–";
    const albumEnabled = item.album && state.libraryMode === "search";
    album.disabled = !albumEnabled;
    if (albumEnabled) album.addEventListener("click", () => loadAlbum(item.album));
    albumCell.append(album);
    const duration = document.createElement("span");
    duration.className = "result-duration";
    duration.textContent = item.duration.replace(/^0:/, "");

    const play = document.createElement("button");
    play.className = "result-play";
    play.dataset.title = item.title;
    play.ariaLabel = t("player.playItem", { title: item.title });
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
    play.addEventListener("click", async () => {
      play.disabled = true;
      try {
        if (play.dataset.action === "pause" && isCurrentResultPlaying(row)) {
          await command("pause");
          state.playing = false;
          updateTrackHighlights();
          setTimeout(refreshStatus, 250);
          return;
        }
        const albumPlayback = state.queue?.options.autoNext && item.parentId && item.album;
        const entries = [albumPlayback ? albumQueueEntry(item) : trackQueueEntry(item)];
        await startPlayback(async ({ target, targetGeneration, isCurrent }) => {
          const queue = await request("/api/queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entries,
              startObjectId: item.id,
              shuffle: false,
              play: target !== "computer",
            }),
          });
          if (!isCurrent()) {
            if (target === "ieast") await request("/api/command", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "pause" }),
            }).catch(() => null);
            return;
          }
          renderQueue(queue, entries);
          if (target === "computer") await playComputerQueueIndexNow(0, targetGeneration);
          else clearCurrentRadio();
          if (!isCurrent()) return;
          playbackSourceGeneration += 1;
          setCurrentTrack(item.title, item.artist);
          notify(t("player.playingItem", { title: item.title }));
          setTimeout(refreshStatus, 500);
        });
      } catch (error) {
        notify(error.message);
      } finally {
        play.disabled = false;
      }
    });
    row.append(cover, details, albumCell, duration, play);
    return row;
}

function renderSearchResults(items, album = "") {
  $("#searchResults").replaceChildren(...items.map(createTrackRow));
  if (album && items.length && !state.selectionsEdited) {
    const entry = { type: "album", serverId: $("#mediaServer").value, album };
    const albumId = items[0].parentId;
    if (albumId && items.every((item) => item.parentId === albumId)) entry.albumId = albumId;
    selectPlaylistEntries([entry]);
  }
  updateTrackHighlights();
}

function renderBrowseEntries(containers, items) {
  const folders = containers.map((folder) => {
    const row = document.createElement("article");
    row.className = "browse-folder";
    const selections = document.createElement("div");
    selections.className = "selection-checks";
    selections.append(selectionCheckbox(t("common.album"), `album:${$("#mediaServer").value}:${folder.id}`, folderQueueEntry(folder)));
    const button = document.createElement("button");
    button.className = "browse-folder-open";
    button.type = "button";
    const icon = document.createElement("span");
    icon.className = "folder-icon";
    icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 7.5h7l2 2h9v9.5H3V7.5Z"/></svg>';
    if (folder.artwork) {
      const cover = document.createElement("img");
      cover.src = folder.artwork;
      cover.alt = "";
      cover.loading = "lazy";
      cover.addEventListener("error", () => cover.remove(), { once: true });
      icon.append(cover);
    }
    const details = document.createElement("span");
    details.className = "folder-details";
    const title = document.createElement("strong");
    title.textContent = folder.title || t("library.unnamedFolder");
    const count = document.createElement("small");
    count.textContent = folder.childCount ? t("library.folderItems", { count: folder.childCount }) : t("common.folder");
    details.append(title, count);
    const arrow = document.createElement("span");
    arrow.className = "folder-arrow";
    arrow.textContent = "→";
    button.append(icon, details, arrow);
    button.addEventListener("click", () => browseFolder(folder));
    row.append(selections, button);
    return row;
  });
  $("#searchResults").replaceChildren(...folders, ...items.map(createTrackRow));
  updateTrackHighlights();
}

async function browseFolder(folder, push = true) {
  if (push) state.browseStack.push({ id: folder.id, title: folder.title });
  const current = state.browseStack.at(-1);
  state.folderSearch = { query: "", page: 1 };
  $("#searchQuery").value = "";
  $("#searchStatus").textContent = t("library.fetching", { name: current.title });
  $("#pagination").hidden = true;
  try {
    const params = new URLSearchParams({ server: $("#mediaServer").value, id: current.id });
    const data = await request(`/api/library/browse?${params}`);
    renderBrowseEntries(data.containers, data.items);
    $("#browsePath").textContent = state.browseStack.map((item) => item.title).join(" / ");
    $("#browseBack").disabled = state.browseStack.length <= 1;
    $("#searchStatus").textContent = t("library.browseSummary", { folders: data.containers.length, files: data.items.length, server: data.server });
  } catch (error) {
    if (push && state.browseStack.length > 1) state.browseStack.pop();
    $("#searchStatus").textContent = error.message;
  }
}

function setLibraryMode(mode, load = true) {
  if (state.libraryMode !== mode) {
    state.selections.clear();
    updateSelectionSummary();
  }
  state.libraryMode = mode;
  const browsing = mode === "browse";
  const spotify = mode === "spotify";
  $("#searchTab").classList.toggle("active", mode === "search");
  $("#browseTab").classList.toggle("active", browsing);
  $("#spotifyTab").classList.toggle("active", spotify);
  $("#searchTab").ariaSelected = String(mode === "search");
  $("#browseTab").ariaSelected = String(browsing);
  $("#spotifyTab").ariaSelected = String(spotify);
  $("#libraryTitle").textContent = t(spotify ? "library.spotifyTitle" : browsing ? "library.browseTitle" : "library.title");
  $("#libraryName").textContent = spotify
    ? t("spotify.nameUpper")
    : state.config.mediaServers.find((item) => item.id === $("#mediaServer").value)?.name || t("common.noServer");
  $("#searchForm").hidden = spotify && !state.spotify.connected;
  $("#searchQuery").value = "";
  $("#searchQuery").placeholder = t(spotify ? "library.searchSpotifyPlaceholder" : browsing ? "library.searchFolderPlaceholder" : "library.searchPlaceholder");
  $("#mediaServer").hidden = spotify;
  $("#spotifyDevice").hidden = !spotify || !state.spotify.connected;
  $("#spotifyPanel").hidden = !spotify;
  $("#browseToolbar").hidden = !browsing;
  $("#backToSearch").hidden = true;
  $("#pagination").hidden = true;
  $("#searchResults").replaceChildren();
  if (browsing && load) {
    const serverName = state.config.mediaServers.find((item) => item.id === $("#mediaServer").value)?.name || t("common.mediaServer");
    state.browseStack = [{ id: "0", title: serverName }];
    browseFolder(state.browseStack[0], false);
  } else if (spotify && load) {
    loadSpotify();
  } else if (load && state.search.query) {
    runSearch(state.search.query, state.search.page);
  } else {
    $("#searchStatus").textContent = t("library.searchPrompt");
  }
}

function renderPagination(page, pages) {
  const pagination = $("#pagination");
  if (pages <= 1) {
    pagination.hidden = true;
    pagination.replaceChildren();
    return;
  }
  const entries = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2]);
  const visiblePages = [...entries].filter((item) => item >= 1 && item <= pages).sort((a, b) => a - b);
  const controls = [];
  const addButton = (label, targetPage, options = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = options.disabled;
    if (options.current) button.ariaCurrent = "page";
    button.addEventListener("click", () => {
      if (state.libraryMode === "browse") runFolderSearch(state.folderSearch.query, targetPage, true);
      else runSearch(state.search.query, targetPage, true);
    });
    controls.push(button);
  };
  addButton("←", page - 1, { disabled: page === 1 });
  visiblePages.forEach((item, index) => {
    if (index && item - visiblePages[index - 1] > 1) {
      const gap = document.createElement("span");
      gap.textContent = "…";
      controls.push(gap);
    }
    addButton(String(item), item, { current: item === page });
  });
  addButton("→", page + 1, { disabled: page === pages });
  pagination.replaceChildren(...controls);
  pagination.hidden = false;
}

async function loadSpotifyDevices() {
  const select = $("#spotifyDevice");
  try {
    const data = await request("/api/spotify/devices");
    state.spotifyDevices = data.devices;
    const selectedId = select.value;
    const devices = state.playbackTarget === "computer"
      ? data.devices.filter((device) => device.type?.toLowerCase() === "computer")
      : data.devices;
    const options = devices.map((device) => {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = `${device.name}${device.active ? ` · ${t("spotify.active")}` : ""}`;
      option.selected = device.id === selectedId || (!selectedId && device.active);
      return option;
    });
    if (!options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = t(state.playbackTarget === "computer" ? "spotify.noComputer" : "spotify.noDevices");
      options.push(option);
    }
    select.replaceChildren(...options);
  } catch (error) {
    const option = document.createElement("option");
    option.textContent = t("spotify.devicesFailed");
    select.replaceChildren(option);
    notify(error.message);
  }
}

async function loadSpotify() {
  const account = $("#spotifyAccount");
  try {
    state.spotify = await request("/api/spotify/status");
    $("#spotifyLogin").hidden = state.spotify.connected || !state.spotify.configured;
    $("#spotifyDisconnect").hidden = !state.spotify.connected;
    $("#searchForm").hidden = !state.spotify.connected;
    $("#spotifyDevice").hidden = !state.spotify.connected;
    if (!state.spotify.configured) {
      account.textContent = t("spotify.notConfigured");
      $("#searchStatus").textContent = t("spotify.redirect", { uri: state.spotify.redirectUri });
    } else if (!state.spotify.connected) {
      account.textContent = t("spotify.notConnected");
      $("#searchStatus").textContent = t("spotify.connectPrompt");
    } else {
      account.textContent = t("spotify.connectedAs", { name: state.spotify.user.name });
      $("#searchStatus").textContent = t("spotify.searchPrompt");
      await loadSpotifyDevices();
    }
  } catch (error) {
    account.textContent = t("spotify.loadFailed");
    $("#searchStatus").textContent = error.message;
  }
}

function renderSpotifyResults(items, albumEntry = null) {
  $("#searchResults").replaceChildren(...items.map((item) => {
    const row = document.createElement("article");
    row.className = "search-result spotify-result";
    if (item.type === "track") row.dataset.track = trackIdentity(item.title, item.subtitle);
    if (item.uri) row.dataset.spotifyUri = item.uri;
    const cover = document.createElement("img");
    cover.className = "result-cover";
    if (item.artwork) cover.src = item.artwork;
    cover.alt = "";
    const details = document.createElement("div");
    details.className = "result-title";
    const title = document.createElement("strong");
    title.textContent = `${item.track ? `${item.disc > 1 ? `${item.disc}.` : ""}${item.track}. ` : ""}${item.title}`;
    const titleLine = document.createElement("div");
    titleLine.className = "result-title-line";
    if (item.type === "track") {
      titleLine.append(selectionCheckbox(t("selection.track"), `spotify-track:${item.uri}`, spotifyTrackQueueEntry(item)));
    } else if (item.type === "album") {
      titleLine.append(selectionCheckbox(t("selection.album"), `spotify-album:${item.uri}`, spotifyAlbumQueueEntry(item)));
    }
    titleLine.append(title);
    const subtitle = document.createElement("span");
    subtitle.textContent = item.subtitle || t(`spotify.type.${item.type}`) || "";
    details.append(titleLine, subtitle);
    const type = document.createElement("span");
    type.className = "spotify-type";
    type.textContent = t(`spotify.type.${item.type}`) || item.type;
    const albumCell = document.createElement("div");
    albumCell.className = "album-cell";
    if (item.type === "track" && item.albumUri) {
      albumCell.append(selectionCheckbox(t("selection.album"), `spotify-album:${item.albumUri}`, spotifyAlbumQueueEntry(item)));
    }
    const detail = document.createElement("button");
    detail.type = "button";
    detail.className = "result-album";
    detail.textContent = item.albumUri ? t("spotify.viewAlbum") : t(`spotify.type.${item.type}`) || item.detail || "–";
    detail.disabled = !item.albumUri;
    if (item.albumUri) detail.addEventListener("click", () => loadSpotifyAlbum(item.albumUri));
    albumCell.append(detail);
    const play = document.createElement("button");
    play.className = "result-play";
    play.dataset.title = t("spotify.onSpotify", { title: item.title });
    play.ariaLabel = t("player.playItem", { title: play.dataset.title });
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
    play.addEventListener("click", async () => {
      play.disabled = true;
      try {
        const spotifyIsCurrentSource = state.playbackTarget === "computer"
          ? state.computerSource === "spotify-connect"
          : state.currentMedia.spotifyUri === item.uri;
        const spotifyUriIsCurrent = state.currentMedia.spotifyUri === row.dataset.spotifyUri;
        if (play.dataset.action === "pause" && isCurrentResultPlaying(row) && spotifyIsCurrentSource && spotifyUriIsCurrent) {
          await command("pause");
          state.playing = false;
          updateTrackHighlights();
          setTimeout(refreshStatus, 250);
          return;
        }
        const computerTarget = state.playbackTarget === "computer";
        const targetGeneration = playbackTargetGeneration;
        const startSpotify = async ({ isCurrent }) => {
          if (!isCurrent()) return;
          let deviceId = spotifyDevice();
          if (computerTarget) {
            computerPlaybackGeneration += 1;
            spotifyManualPausePending = false;
            spotifyResumePending = false;
            deviceId = await prepareSpotifyComputerPlayback();
            if (!isCurrent()) return;
          }
          const result = albumEntry && item.type === "track"
            ? await request("/api/queue", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entries: [albumEntry], startObjectId: item.uri, play: !computerTarget, shuffle: false, deviceId }),
            })
            : await request("/api/spotify/play", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uri: item.uri, deviceId }),
            });
          if (!isCurrent()) {
            await pauseSpotifyDevice(deviceId).catch(() => null);
            return;
          }
          playbackSourceGeneration += 1;
          if (albumEntry) {
            renderQueue(result, [albumEntry]);
            if (computerTarget) await playComputerQueueIndexNow(0, targetGeneration);
          } else if (computerTarget) {
            state.computerQueueIndex = -1;
            state.computerQueueItemId = "";
          }
          if (item.type === "track") {
            clearCurrentRadio();
            state.currentMedia = { ...(state.currentMedia || {}), spotifyUri: item.uri };
            setCurrentTrack(item.title, item.subtitle, true, item.uri);
          }
          notify(albumEntry ? t("player.playingItem", { title: item.title }) : t("player.playingOn", { title: item.title, device: result.device }));
        };
        await startPlayback(startSpotify);
        setTimeout(refreshStatus, 700);
      } catch (error) {
        notify(error.message);
      } finally {
        play.disabled = false;
      }
    });
    row.append(cover, details, albumCell, type, play);
    return row;
  }));
  updateTrackHighlights();
}

async function runSpotifySearch(query) {
  const button = $("#searchForm button");
  state.spotifySearch.query = query;
  button.disabled = true;
  $("#backToSearch").hidden = true;
  $("#searchStatus").textContent = t("spotify.searching", { query });
  $("#pagination").hidden = true;
  try {
    const data = await request(`/api/spotify/search?q=${encodeURIComponent(query)}`);
    renderSpotifyResults(data.items);
    $("#searchStatus").textContent = data.items.length
      ? t("spotify.results", { count: data.items.length })
      : t("library.noResults", { query });
  } catch (error) {
    $("#searchStatus").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadSpotifyAlbum(uri) {
  $("#backToSearch").hidden = false;
  $("#pagination").hidden = true;
  $("#searchStatus").textContent = t("spotify.loadingAlbum");
  try {
    const data = await request(`/api/spotify/album?uri=${encodeURIComponent(uri)}`);
    const albumEntry = { type: "spotifyAlbum", uri, album: data.album, artist: data.artist, artwork: data.items[0]?.artwork || null };
    renderSpotifyResults(data.items, albumEntry);
    if (!state.selectionsEdited) selectPlaylistEntries([albumEntry]);
    $("#searchStatus").textContent = t("spotify.albumSummary", { album: data.album, artist: data.artist, count: data.items.length });
    $("#searchStatus").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#searchStatus").textContent = error.message;
  }
}

$("#spotifyDisconnect").addEventListener("click", async () => {
  try {
    await request("/api/spotify/disconnect", { method: "POST" });
    state.spotify.connected = false;
    $("#searchResults").replaceChildren();
    await loadSpotify();
    notify(t("spotify.disconnected"));
  } catch (error) {
    notify(error.message);
  }
});

async function runSearch(query, page = 1, scrollToResults = false) {
  const button = $("#searchForm button");
  state.search = { query, page };
  button.disabled = true;
  $("#backToSearch").hidden = true;
  $("#searchStatus").textContent = t("library.searching", { query });
  try {
    const serverId = $("#mediaServer").value;
    const params = new URLSearchParams({ q: query, server: serverId, page });
    const data = await request(`/api/library/search?${params}`);
    const album = data.items[0]?.album || "";
    const albumSearch = album.localeCompare(query, undefined, { sensitivity: "accent" }) === 0
      && data.items.every((item) => item.album === album);
    renderSearchResults(data.items, albumSearch ? album : "");
    state.search.page = data.page;
    $("#searchStatus").textContent = data.items.length
      ? t("library.results", { page: data.page, pages: data.pages, count: data.total, server: data.server })
      : t("library.noResults", { query });
    renderPagination(data.page, data.pages);
    if (scrollToResults) $("#searchStatus").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#searchStatus").textContent = error.message;
    $("#pagination").hidden = true;
  } finally {
    button.disabled = false;
  }
}

async function loadAlbum(album) {
  $("#backToSearch").hidden = false;
  $("#pagination").hidden = true;
  $("#searchStatus").textContent = t("library.loadingAlbum", { album });
  try {
    const params = new URLSearchParams({ album, server: $("#mediaServer").value });
    const data = await request(`/api/library/album?${params}`);
    renderSearchResults(data.items, data.album);
    $("#searchStatus").textContent = t("library.albumSummary", { album: data.album, count: data.items.length, server: data.server });
    $("#searchStatus").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#searchStatus").textContent = error.message;
  }
}

function selectMediaServer(serverId) {
  if (serverId && (state.config?.mediaServers || []).some((server) => server.id === serverId)) {
    $("#mediaServer").value = serverId;
  }
}

async function openNowPlayingAlbum() {
  const media = state.currentMedia;
  if (!media?.album) return;
  if (media.albumUri) {
    setLibraryMode("spotify", false);
    await loadSpotifyAlbum(media.albumUri);
  } else {
    const serverId = media.serverId || $("#mediaServer").value || state.config?.mediaServers?.[0]?.id;
    if (!serverId) return notify(t("library.noServerAlbum"));
    selectMediaServer(serverId);
    setLibraryMode("search", false);
    await loadAlbum(media.album);
  }
}

function scrollToCurrentTrack() {
  const currentRow = [...document.querySelectorAll(".search-result[data-track]")]
    .find((row) => row.dataset.track === state.currentTrack);
  currentRow?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function openNowPlayingFolder() {
  const media = state.currentMedia;
  if (!media?.title) return;
  if (media.albumUri) {
    setLibraryMode("spotify", false);
    await loadSpotifyAlbum(media.albumUri);
    scrollToCurrentTrack();
    return;
  }

  const serverId = media.serverId || $("#mediaServer").value || state.config?.mediaServers?.[0]?.id;
  if (!serverId) return notify(t("library.noServerTrack"));
  let parentId = media.parentId;
  let folderTitle = media.folderTitle;
  if (!parentId) {
    try {
      const params = new URLSearchParams({ q: media.title, server: serverId });
      const data = await request(`/api/library/search?${params}`);
      const match = data.items.find((item) => trackIdentity(item.title, item.artist) === state.currentTrack)
        || data.items.find((item) => trackIdentity(item.title) === trackIdentity(media.title));
      parentId = match?.parentId;
      folderTitle = match?.album || folderTitle;
    } catch (error) {
      return notify(error.message);
    }
  }
  if (!parentId) return notify(t("library.folderNotFound"));

  selectMediaServer(serverId);
  setLibraryMode("browse", false);
  const serverName = (state.config?.mediaServers || []).find((server) => server.id === serverId)?.name || t("common.mediaServer");
  const folder = { id: parentId, title: folderTitle || media.album || t("common.folder") };
  state.browseStack = [{ id: "0", title: serverName }];
  if (folder.id !== "0") state.browseStack.push(folder);
  await browseFolder(folder, false);
  scrollToCurrentTrack();
}

async function runFolderSearch(query, page = 1, scrollToResults = false) {
  const current = state.browseStack.at(-1);
  if (!current) return;
  const button = $("#searchForm button");
  state.folderSearch = { query, page };
  button.disabled = true;
  $("#searchStatus").textContent = t("library.searchingFolder", { folder: current.title, query });
  try {
    const params = new URLSearchParams({
      q: query,
      server: $("#mediaServer").value,
      page,
      container: current.id,
    });
    const data = await request(`/api/library/search?${params}`);
    renderSearchResults(data.items);
    state.folderSearch.page = data.page;
    $("#searchStatus").textContent = data.items.length
      ? t("library.folderResults", { page: data.page, pages: data.pages, count: data.total, folder: current.title })
      : t("library.noFolderResults", { query, folder: current.title });
    renderPagination(data.page, data.pages);
    if (scrollToResults) $("#searchStatus").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#searchStatus").textContent = error.message;
    $("#pagination").hidden = true;
  } finally {
    button.disabled = false;
  }
}

$("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = $("#searchQuery").value.trim();
  if (state.libraryMode === "spotify") runSpotifySearch(query);
  else if (state.libraryMode === "browse") runFolderSearch(query);
  else runSearch(query);
});

$("#searchQuery").addEventListener("search", () => {
  if (state.libraryMode === "browse" && !$("#searchQuery").value) browseFolder(state.browseStack.at(-1), false);
});
$("#searchQuery").addEventListener("input", () => {
  if (state.libraryMode === "browse" && !$("#searchQuery").value && state.folderSearch.query) {
    browseFolder(state.browseStack.at(-1), false);
  }
});

$("#backToSearch").addEventListener("click", () => {
  if (state.libraryMode === "spotify") runSpotifySearch(state.spotifySearch.query);
  else runSearch(state.search.query, state.search.page, true);
});
$("#searchTab").addEventListener("click", () => setLibraryMode("search"));
$("#browseTab").addEventListener("click", () => setLibraryMode("browse"));
$("#spotifyTab").addEventListener("click", () => setLibraryMode("spotify"));
$("#title").addEventListener("click", openNowPlayingFolder);
$("#album").addEventListener("click", openNowPlayingAlbum);

for (const [id, key] of [["queueAutoNext", "autoNext"], ["queueContinueAlbums", "continueAlbums"]]) {
  $(`#${id}`).addEventListener("change", async (event) => {
    try {
      renderQueue(await request("/api/queue/options", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: event.target.checked }),
      }));
    } catch (error) {
      notify(error.message);
      loadQueue();
    }
  });
}

async function submitSelection(mode) {
  try {
    const entries = [...state.selections.values()];
    const submit = async ({ target, targetGeneration, isCurrent = () => true }) => {
      const queue = await request("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries,
          mode,
          play: mode !== "append" && target !== "computer",
          shuffle: false,
          deviceId: spotifyDevice(),
          syncSpotify: target !== "computer",
        }),
      });
      if (!isCurrent()) return;
      renderQueue(queue);
      if (mode !== "append" && target === "computer") await playComputerQueueIndexNow(0, targetGeneration);
      if (isCurrent()) notify(t(mode === "append" ? "queue.appended" : "queue.playingSelection"));
    };
    if (mode === "append") await submit({ target: state.playbackTarget });
    else await startPlayback(submit);
  } catch (error) {
    notify(error.message);
  }
}

$("#playSelection").addEventListener("click", () => submitSelection("replace"));
$("#appendSelection").addEventListener("click", () => submitSelection("append"));
$("#saveSelection").addEventListener("click", async () => {
  try {
    const data = await request("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: $("#playlistName").value, entries: [...state.selections.values()] }),
    });
    $("#playlistName").value = "";
    renderQueue(data);
    notify(t("playlists.saved"));
  } catch (error) {
    notify(error.message);
  }
});
$("#playPlaylist").addEventListener("click", async () => {
  const id = $("#savedPlaylist").value;
  const playlist = state.queue?.playlists.find((item) => item.id === id);
  if (!playlist) return;
  try {
    await startPlayback(async ({ target, targetGeneration, isCurrent }) => {
      const queue = await request(`/api/playlists/${id}/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shuffle: $("#playlistShuffle").checked, deviceId: spotifyDevice(), play: target !== "computer" }),
      });
      if (!isCurrent()) return;
      renderQueue(queue, playlist.entries);
      if (target === "computer") await playComputerQueueIndexNow(0, targetGeneration);
    });
  } catch (error) {
    notify(error.message);
  }
});
$("#savedPlaylist").addEventListener("change", async () => {
  renderPlaylistContents();
  const playlist = state.queue?.playlists.find((item) => item.id === $("#savedPlaylist").value);
  if (!playlist) return;
  selectPlaylistEntries(playlist.entries);
  try {
    renderQueue(await request("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: playlist.entries, play: false, shuffle: $("#playlistShuffle").checked }),
    }));
  } catch (error) {
    notify(error.message);
  }
});
$("#updatePlaylist").addEventListener("click", async () => {
  const id = $("#savedPlaylist").value;
  if (!id) return;
  try {
    const data = await request(`/api/playlists/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [...state.selections.values()] }),
    });
    renderQueue(data);
    notify(t("playlists.updated"));
  } catch (error) {
    notify(error.message);
  }
});
$("#deletePlaylist").addEventListener("click", async () => {
  const id = $("#savedPlaylist").value;
  if (!id) return;
  try {
    renderQueue(await request(`/api/playlists/${id}`, { method: "DELETE" }));
    notify(t("playlists.deleted"));
  } catch (error) {
    notify(error.message);
  }
});
$("#clearQueue").addEventListener("click", async () => {
  try {
    const stopComputer = state.playbackTarget === "computer" && state.computerQueueIndex >= 0;
    if (stopComputer) computerPlaybackGeneration += 1;
    renderQueue(await request("/api/queue", { method: "DELETE" }));
    if (stopComputer) {
      computerAudio.pause();
      await pauseSpotifyComputer();
      state.computerSource = null;
      state.computerQueueIndex = -1;
      state.computerQueueItemId = "";
      state.computerStatus = null;
      refreshComputerStatus();
    }
    selectPlaylistEntries([]);
  } catch (error) {
    notify(error.message);
  }
});
$("#shuffleQueue").addEventListener("click", async () => {
  try {
    renderQueue(await request("/api/queue/shuffle", { method: "POST" }));
  } catch (error) {
    notify(error.message);
  }
});
$("#resetQueueOrder").addEventListener("click", async () => {
  try {
    renderQueue(await request("/api/queue/reset", { method: "POST" }));
  } catch (error) {
    notify(error.message);
  }
});
$("#browseBack").addEventListener("click", () => {
  if (state.browseStack.length <= 1) return;
  state.browseStack.pop();
  browseFolder(state.browseStack.at(-1), false);
});

$("#mediaServer").addEventListener("change", () => {
  const server = state.config.mediaServers.find((item) => item.id === $("#mediaServer").value);
  $("#libraryName").textContent = server?.name || t("common.noServer");
  $("#searchResults").replaceChildren();
  $("#pagination").hidden = true;
  $("#backToSearch").hidden = true;
  if (state.libraryMode === "browse" && server) {
    state.browseStack = [{ id: "0", title: server.name }];
    browseFolder(state.browseStack[0], false);
  } else {
    $("#searchStatus").textContent = server
      ? t("library.searchServer", { server: server.name })
      : t("library.addServerPrompt");
  }
});

function addServerSettingsRow(server = {}) {
  const row = document.createElement("div");
  row.className = "server-setting-row";
  row.dataset.id = server.id || crypto.randomUUID();
  const name = document.createElement("input");
  name.className = "settings-input server-name";
  name.placeholder = t("settings.serverNamePlaceholder");
  name.value = server.name || "";
  name.required = true;
  const url = document.createElement("input");
  url.className = "settings-input server-url";
  url.placeholder = "192.168.1.101";
  url.value = server.url || "";
  url.required = true;
  const remove = document.createElement("button");
  remove.className = "remove-button";
  remove.type = "button";
  remove.ariaLabel = t("settings.removeServer");
  remove.textContent = "×";
  remove.addEventListener("click", () => row.remove());
  row.append(name, url, remove);
  $("#serverSettings").append(row);
}

function addRadioSettingsRow(radio = {}) {
  const row = document.createElement("div");
  row.className = "radio-setting-row";
  row.dataset.id = radio.id || crypto.randomUUID();
  const name = document.createElement("input");
  name.className = "settings-input radio-setting-name";
  name.placeholder = t("radio.namePlaceholder");
  name.value = radio.name || "";
  name.required = true;
  const url = document.createElement("input");
  url.className = "settings-input radio-setting-url";
  url.type = "url";
  url.placeholder = "http://radio.dk/stream.mp3";
  url.value = radio.url || "";
  url.required = true;
  const artwork = document.createElement("input");
  artwork.className = "settings-input radio-setting-artwork";
  artwork.type = "url";
  artwork.placeholder = t("radio.logoPlaceholder");
  artwork.value = radio.artwork || "";
  const remove = document.createElement("button");
  remove.className = "remove-button";
  remove.type = "button";
  remove.ariaLabel = t("radio.remove", { name: radio.name || t("radio.station") });
  remove.textContent = "×";
  remove.addEventListener("click", () => row.remove());
  row.append(name, url, artwork, remove);
  $("#radioSettings").append(row);
}

function setSpotifyRedirectUri(uri) {
  $("#spotifyRedirectUriHelp").textContent = uri;
  $("#spotifyRedirectUriTutorial").textContent = uri;
  const url = new URL(uri);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  $("#spotifyRedirectNotice").textContent = t(url.protocol === "http:" && !loopback
    ? "spotify.redirectHttps"
    : loopback ? "spotify.redirectLoopback" : "spotify.redirectDashboard");
}

function openSettings() {
  if (!state.config) return;
  $("#settingsDeviceIp").value = state.config.deviceIp;
  $("#settingsLanguage").value = I18n.normalize(state.config.language);
  $("#spotifyClientId").value = state.config.spotifyClientId || "";
  $("#serverSettings").replaceChildren();
  state.config.mediaServers.forEach(addServerSettingsRow);
  $("#radioSettings").replaceChildren();
  state.config.radios.forEach(addRadioSettingsRow);
  const localRedirect = new URL("/api/spotify/callback", window.location.origin);
  if (localRedirect.hostname === "localhost") localRedirect.hostname = "127.0.0.1";
  setSpotifyRedirectUri(state.spotify.redirectUri || localRedirect.href);
  $("#settingsDialog").showModal();
  request("/api/spotify/status").then((spotify) => {
    state.spotify = spotify;
    setSpotifyRedirectUri(spotify.redirectUri);
  }).catch(() => {});
}

$("#openSettings").addEventListener("click", openSettings);
$("#closeSettings").addEventListener("click", () => $("#settingsDialog").close());
$("#cancelSettings").addEventListener("click", () => $("#settingsDialog").close());
$("#openSpotifyHelp").addEventListener("click", () => $("#spotifyHelpDialog").showModal());
$("#closeSpotifyHelp").addEventListener("click", () => $("#spotifyHelpDialog").close());
$("#finishSpotifyHelp").addEventListener("click", () => $("#spotifyHelpDialog").close());
$("#addServer").addEventListener("click", () => addServerSettingsRow());
$("#addRadio").addEventListener("click", () => addRadioSettingsRow());
$("#settingsDialog").addEventListener("click", (event) => {
  if (event.target === $("#settingsDialog")) $("#settingsDialog").close();
});
$("#spotifyHelpDialog").addEventListener("click", (event) => {
  if (event.target === $("#spotifyHelpDialog")) $("#spotifyHelpDialog").close();
});
$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const mediaServers = [...document.querySelectorAll(".server-setting-row")].map((row) => ({
    id: row.dataset.id,
    name: row.querySelector(".server-name").value,
    url: row.querySelector(".server-url").value,
  }));
  const radios = [...document.querySelectorAll(".radio-setting-row")].map((row) => ({
    id: row.dataset.id,
    name: row.querySelector(".radio-setting-name").value,
    url: row.querySelector(".radio-setting-url").value,
    artwork: row.querySelector(".radio-setting-artwork").value || null,
    rating: state.config.radios.find((radio) => radio.id === row.dataset.id)?.rating || 0,
  }));
  try {
    const previousLanguage = I18n.normalize(state.config.language);
    const language = I18n.normalize($("#settingsLanguage").value);
    await saveConfiguration({
      ...state.config,
      language,
      deviceIp: $("#settingsDeviceIp").value,
      spotifyClientId: $("#spotifyClientId").value,
      mediaServers,
      radios,
    });
    $("#settingsDialog").close();
    if (language !== previousLanguage) {
      location.reload();
      return;
    }
    notify(t("settings.saved"));
    state.deviceLoaded = false;
    refreshStatus();
    loadDevice();
  } catch (error) {
    notify(error.message);
  }
});

setRange($("#volume"), Number($("#volume").value), 100);
renderToneValue("bass", $("#bass").value);
renderToneValue("treble", $("#treble").value);

async function initialize() {
  state.playbackTarget = storedPlaybackTarget();
  $("#playbackTarget").value = state.playbackTarget;
  $(".tone-controls").hidden = state.playbackTarget === "computer";
  $("#settingsLanguage").replaceChildren(...Object.entries(I18n.localeNames).map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  await loadConfiguration();
  await Promise.all([refreshStatus(), loadDevice()]);
  setInterval(refreshStatus, 2000);
}

initialize();
