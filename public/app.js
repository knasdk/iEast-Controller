const $ = (selector) => document.querySelector(selector);
const state = {
  playing: false,
  muted: false,
  seeking: false,
  volumeChanging: false,
  artworkKey: "",
  currentTrack: null,
  config: null,
  search: { query: "", page: 1 },
  folderSearch: { query: "", page: 1 },
  libraryMode: "search",
  browseStack: [],
  spotify: { configured: false, connected: false },
  spotifySearch: { query: "" },
};
let toastTimer;

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
    const active = state.playing && row.dataset.track === state.currentTrack;
    row.classList.toggle("is-current", active);
    if (active) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
    const button = row.querySelector(".result-play");
    if (button) {
      button.dataset.action = active ? "pause" : "play";
      button.ariaLabel = active ? "Sæt på pause" : `Afspil ${button.dataset.title}`;
      button.innerHTML = active
        ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
    }
  });
}

function setCurrentTrack(title, artist, playing = true) {
  state.currentTrack = title ? trackIdentity(title, artist) : null;
  state.playing = playing;
  updateTrackHighlights();
}

function setRange(range, value, max = Number(range.max)) {
  range.value = value;
  range.style.setProperty("--value", `${max ? (value / max) * 100 : 0}%`);
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
  if (!response.ok) throw new Error(data.error || "Handlingen mislykkedes");
  return data;
}

async function command(action, value) {
  try {
    await request("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, value }),
    });
    setTimeout(refreshStatus, 250);
  } catch (error) {
    notify(error.message);
  }
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
    cover.alt = `Cover til ${title}`;
    cover.hidden = false;
  } catch {
    cover.hidden = true;
  }
}

function renderStatus(data) {
  state.playing = data.status === "play" || data.status === "playing";
  state.muted = data.mute === "1" || data.mute === 1;
  document.body.classList.toggle("is-playing", state.playing);
  document.body.classList.toggle("is-muted", state.muted);
  $("#playButton").dataset.action = state.playing ? "pause" : "play";
  $("#playButton").ariaLabel = state.playing ? "Pause" : "Afspil";
  $("#muteButton").ariaLabel = state.muted ? "Slå lyden til" : "Slå lyden fra";

  const title = decodeMetadata(data.Title || data.title) || "Klar til musik";
  const artist = decodeMetadata(data.Artist || data.artist || data.Album) || "Vælg en stream eller start afspilning";
  setCurrentTrack(title === "Klar til musik" ? "" : title, artist, state.playing);
  $("#title").textContent = title;
  $("#artist").textContent = artist;
  if (data.disableArtwork) resetArtwork();
  else if (title !== "Klar til musik") updateArtwork(title, artist, data.artwork);
  $("#source").textContent = data.status === "stop" ? "IEAST STREAMER" : "AFSPILLER NU";

  const duration = Number(data.totlen) || 0;
  const position = Math.min(Number(data.curpos) || 0, duration || Infinity);
  const tonearmProgress = data.mediaType === "radio" || !duration ? 0 : Math.min(1, position / duration);
  $("#artwork").style.setProperty("--tonearm-angle", `${-18 + tonearmProgress * 18}deg`);
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
  try {
    const data = await request("/api/status");
    renderStatus(data);
    $("#connection").className = "connection online";
    $("#connectionText").textContent = "Forbundet";
  } catch (error) {
    $("#connection").className = "connection offline";
    $("#connectionText").textContent = "Ingen forbindelse";
  }
}

async function loadDevice() {
  try {
    const data = await request("/api/device");
    $("#deviceName").textContent = data.name || "iEast";
    $("#deviceIp").textContent = data.ip;
    $("#firmware").textContent = data.firmware || "–";
    $("#signal").textContent = Number.isFinite(data.signal) ? `${data.signal} dBm` : "–";
    document.title = `${data.name || "iEast"} · Controller`;
  } catch {
    // The status poll displays connection errors; device details can remain blank.
  }
}

async function saveConfiguration(nextConfig) {
  state.config = await request("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextConfig),
  });
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
    ? "SPOTIFY"
    : servers.find((server) => server.id === $("#mediaServer").value)?.name || "INGEN SERVER";
  renderRadios();
}

async function loadConfiguration() {
  try {
    state.config = await request("/api/config");
    renderConfiguration();
    const params = new URLSearchParams(location.search);
    if (params.has("spotify") || params.has("spotifyError")) {
      setLibraryMode("spotify");
      notify(params.get("spotifyError") || "Spotify er forbundet");
      history.replaceState({}, "", location.pathname);
    }
  } catch (error) {
    notify(error.message);
  }
}

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => command(button.dataset.action));
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
    await request("/api/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: radio.url,
        metadata: {
          title: radio.name,
          artist: "Radio",
          artwork: radio.artwork,
          disableArtwork: !radio.artwork,
          mediaType: "radio",
        },
      }),
    });
    notify(`Afspiller ${radio.name}`);
    setTimeout(refreshStatus, 500);
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
}

function renderRadios() {
  const radios = [...(state.config?.radios || [])].sort((a, b) =>
    (Number(b.rating) || 0) - (Number(a.rating) || 0) || a.name.localeCompare(b.name, "da", { sensitivity: "base" })
  );
  const list = $("#radioList");
  if (!radios.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "Ingen gemte stationer endnu.";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...radios.map((radio) => {
    const row = document.createElement("div");
    row.className = "radio-item";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = radio.name;
    const url = document.createElement("span");
    url.textContent = radio.url;
    info.append(name, url);
    const rating = document.createElement("div");
    rating.className = "radio-rating";
    rating.setAttribute("aria-label", `Bedømmelse af ${radio.name}`);
    for (let value = 1; value <= 5; value += 1) {
      const star = document.createElement("button");
      star.type = "button";
      star.className = value <= (radio.rating || 0) ? "active" : "";
      star.textContent = "★";
      star.ariaLabel = `${value} ${value === 1 ? "stjerne" : "stjerner"}`;
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
    play.ariaLabel = `Afspil ${radio.name}`;
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
    play.addEventListener("click", () => playRadio(radio, play));
    row.append(info, rating, play);
    return row;
  }));
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
    title.textContent = `${item.track ? `${item.track}. ` : ""}${item.title || "Ukendt titel"}`;
    const artist = document.createElement("span");
    artist.textContent = item.artist || "Ukendt artist";
    details.append(title, artist);

    const album = document.createElement("button");
    album.className = "result-album";
    album.type = "button";
    album.textContent = item.album || "–";
    const albumEnabled = item.album && state.libraryMode === "search";
    album.disabled = !albumEnabled;
    if (albumEnabled) album.addEventListener("click", () => loadAlbum(item.album));
    const duration = document.createElement("span");
    duration.className = "result-duration";
    duration.textContent = item.duration.replace(/^0:/, "");

    const play = document.createElement("button");
    play.className = "result-play";
    play.dataset.title = item.title;
    play.ariaLabel = `Afspil ${item.title}`;
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
    play.addEventListener("click", async () => {
      play.disabled = true;
      try {
        if (play.dataset.action === "pause") {
          await request("/api/command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "pause" }),
          });
          state.playing = false;
          updateTrackHighlights();
          setTimeout(refreshStatus, 250);
          return;
        }
        await request("/api/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: item.url,
            metadata: {
              title: item.title,
              artist: item.artist,
              album: item.album,
              artwork: item.artwork,
              mediaType: "track",
            },
          }),
        });
        setCurrentTrack(item.title, item.artist);
        notify(`Afspiller ${item.title}`);
        setTimeout(refreshStatus, 500);
      } catch (error) {
        notify(error.message);
      } finally {
        play.disabled = false;
      }
    });
    row.append(cover, details, album, duration, play);
    return row;
}

function renderSearchResults(items) {
  $("#searchResults").replaceChildren(...items.map(createTrackRow));
  updateTrackHighlights();
}

function renderBrowseEntries(containers, items) {
  const folders = containers.map((folder) => {
    const button = document.createElement("button");
    button.className = "browse-folder";
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
    title.textContent = folder.title || "Unavngiven mappe";
    const count = document.createElement("small");
    count.textContent = folder.childCount ? `${folder.childCount} elementer` : "Mappe";
    details.append(title, count);
    const arrow = document.createElement("span");
    arrow.className = "folder-arrow";
    arrow.textContent = "→";
    button.append(icon, details, arrow);
    button.addEventListener("click", () => browseFolder(folder));
    return button;
  });
  $("#searchResults").replaceChildren(...folders, ...items.map(createTrackRow));
  updateTrackHighlights();
}

async function browseFolder(folder, push = true) {
  if (push) state.browseStack.push({ id: folder.id, title: folder.title });
  const current = state.browseStack.at(-1);
  state.folderSearch = { query: "", page: 1 };
  $("#searchQuery").value = "";
  $("#searchStatus").textContent = `Henter ${current.title}...`;
  $("#pagination").hidden = true;
  try {
    const params = new URLSearchParams({ server: $("#mediaServer").value, id: current.id });
    const data = await request(`/api/library/browse?${params}`);
    renderBrowseEntries(data.containers, data.items);
    $("#browsePath").textContent = state.browseStack.map((item) => item.title).join(" / ");
    $("#browseBack").disabled = state.browseStack.length <= 1;
    $("#searchStatus").textContent = `${data.containers.length} mapper · ${data.items.length} lydfiler på ${data.server}`;
  } catch (error) {
    if (push && state.browseStack.length > 1) state.browseStack.pop();
    $("#searchStatus").textContent = error.message;
  }
}

function setLibraryMode(mode) {
  state.libraryMode = mode;
  const browsing = mode === "browse";
  const spotify = mode === "spotify";
  $("#searchTab").classList.toggle("active", mode === "search");
  $("#browseTab").classList.toggle("active", browsing);
  $("#spotifyTab").classList.toggle("active", spotify);
  $("#searchTab").ariaSelected = String(mode === "search");
  $("#browseTab").ariaSelected = String(browsing);
  $("#spotifyTab").ariaSelected = String(spotify);
  $("#libraryTitle").textContent = spotify ? "Søg på Spotify" : browsing ? "Gennemse mapper" : "Find din næste sang";
  $("#libraryName").textContent = spotify
    ? "SPOTIFY"
    : state.config.mediaServers.find((item) => item.id === $("#mediaServer").value)?.name || "INGEN SERVER";
  $("#searchForm").hidden = spotify && !state.spotify.connected;
  $("#searchQuery").value = "";
  $("#searchQuery").placeholder = spotify ? "Søg efter musik på Spotify" : browsing ? "Søg i denne mappe" : "Søg efter titel, artist eller album";
  $("#mediaServer").hidden = spotify;
  $("#spotifyDevice").hidden = !spotify || !state.spotify.connected;
  $("#spotifyPanel").hidden = !spotify;
  $("#browseToolbar").hidden = !browsing;
  $("#backToSearch").hidden = true;
  $("#pagination").hidden = true;
  $("#searchResults").replaceChildren();
  if (browsing) {
    const serverName = state.config.mediaServers.find((item) => item.id === $("#mediaServer").value)?.name || "Medieserver";
    state.browseStack = [{ id: "0", title: serverName }];
    browseFolder(state.browseStack[0], false);
  } else if (spotify) {
    loadSpotify();
  } else if (state.search.query) {
    runSearch(state.search.query, state.search.page);
  } else {
    $("#searchStatus").textContent = "Søg efter titel, artist eller album.";
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
    const options = data.devices.map((device) => {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = `${device.name}${device.active ? " · aktiv" : ""}`;
      option.selected = device.active;
      return option;
    });
    if (!options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Ingen Connect-enheder";
      options.push(option);
    }
    select.replaceChildren(...options);
  } catch (error) {
    const option = document.createElement("option");
    option.textContent = "Kunne ikke hente enheder";
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
      account.textContent = "Tilføj din Spotify Client ID under Indstillinger for at komme i gang.";
      $("#searchStatus").textContent = `Brug redirect URI: ${state.spotify.redirectUri}`;
    } else if (!state.spotify.connected) {
      account.textContent = "Spotify er konfigureret, men kontoen er ikke forbundet.";
      $("#searchStatus").textContent = "Forbind din Spotify Premium-konto for at søge og afspille.";
    } else {
      account.textContent = `Forbundet som ${state.spotify.user.name}`;
      $("#searchStatus").textContent = "Søg efter numre, albums, artister eller playlister.";
      await loadSpotifyDevices();
    }
  } catch (error) {
    account.textContent = "Spotify kunne ikke indlæses.";
    $("#searchStatus").textContent = error.message;
  }
}

function renderSpotifyResults(items) {
  const typeNames = { track: "Nummer", album: "Album", artist: "Artist", playlist: "Playlist" };
  $("#searchResults").replaceChildren(...items.map((item) => {
    const row = document.createElement("article");
    row.className = "search-result spotify-result";
    if (item.type === "track") row.dataset.track = trackIdentity(item.title, item.subtitle);
    const cover = document.createElement("img");
    cover.className = "result-cover";
    if (item.artwork) cover.src = item.artwork;
    cover.alt = "";
    const details = document.createElement("div");
    details.className = "result-title";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const subtitle = document.createElement("span");
    subtitle.textContent = item.subtitle;
    details.append(title, subtitle);
    const type = document.createElement("span");
    type.className = "spotify-type";
    type.textContent = typeNames[item.type] || item.type;
    const detail = document.createElement("button");
    detail.type = "button";
    detail.className = "result-album";
    detail.textContent = item.detail || "–";
    detail.disabled = !item.albumUri;
    if (item.albumUri) detail.addEventListener("click", () => loadSpotifyAlbum(item.albumUri));
    const play = document.createElement("button");
    play.className = "result-play";
    play.dataset.title = `${item.title} på Spotify`;
    play.ariaLabel = `Afspil ${item.title} på Spotify`;
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
    play.addEventListener("click", async () => {
      play.disabled = true;
      try {
        if (play.dataset.action === "pause") {
          await request("/api/command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "pause" }),
          });
          state.playing = false;
          updateTrackHighlights();
          setTimeout(refreshStatus, 250);
          return;
        }
        const result = await request("/api/spotify/play", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uri: item.uri, deviceId: $("#spotifyDevice").value }),
        });
        if (item.type === "track") setCurrentTrack(item.title, item.subtitle);
        notify(`Afspiller ${item.title} på ${result.device}`);
        setTimeout(refreshStatus, 700);
      } catch (error) {
        notify(error.message);
      } finally {
        play.disabled = false;
      }
    });
    row.append(cover, details, detail, type, play);
    return row;
  }));
  updateTrackHighlights();
}

async function runSpotifySearch(query) {
  const button = $("#searchForm button");
  state.spotifySearch.query = query;
  button.disabled = true;
  $("#backToSearch").hidden = true;
  $("#searchStatus").textContent = `Søger på Spotify efter “${query}”...`;
  $("#pagination").hidden = true;
  try {
    const data = await request(`/api/spotify/search?q=${encodeURIComponent(query)}`);
    renderSpotifyResults(data.items);
    $("#searchStatus").textContent = data.items.length ? `${data.items.length} resultater fra Spotify` : `Ingen resultater for “${query}”`;
  } catch (error) {
    $("#searchStatus").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadSpotifyAlbum(uri) {
  $("#backToSearch").hidden = false;
  $("#pagination").hidden = true;
  $("#searchStatus").textContent = "Henter album fra Spotify...";
  try {
    const data = await request(`/api/spotify/album?uri=${encodeURIComponent(uri)}`);
    renderSpotifyResults(data.items);
    $("#searchStatus").textContent = `${data.album} · ${data.artist} · ${data.items.length} numre`;
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
    notify("Spotify-forbindelsen er fjernet");
  } catch (error) {
    notify(error.message);
  }
});

async function runSearch(query, page = 1, scrollToResults = false) {
  const button = $("#searchForm button");
  state.search = { query, page };
  button.disabled = true;
  $("#backToSearch").hidden = true;
  $("#searchStatus").textContent = `Søger efter “${query}”...`;
  try {
    const serverId = $("#mediaServer").value;
    const params = new URLSearchParams({ q: query, server: serverId, page });
    const data = await request(`/api/library/search?${params}`);
    renderSearchResults(data.items);
    state.search.page = data.page;
    $("#searchStatus").textContent = data.items.length
      ? `Side ${data.page} af ${data.pages} · ${data.total} resultater på ${data.server}`
      : `Ingen resultater for “${query}”`;
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
  $("#searchStatus").textContent = `Henter albummet “${album}”...`;
  try {
    const params = new URLSearchParams({ album, server: $("#mediaServer").value });
    const data = await request(`/api/library/album?${params}`);
    renderSearchResults(data.items);
    $("#searchStatus").textContent = `${data.album} · ${data.items.length} numre på ${data.server}`;
    $("#searchStatus").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#searchStatus").textContent = error.message;
  }
}

async function runFolderSearch(query, page = 1, scrollToResults = false) {
  const current = state.browseStack.at(-1);
  if (!current) return;
  const button = $("#searchForm button");
  state.folderSearch = { query, page };
  button.disabled = true;
  $("#searchStatus").textContent = `Søger i ${current.title} efter “${query}”...`;
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
      ? `Side ${data.page} af ${data.pages} · ${data.total} resultater i ${current.title}`
      : `Ingen resultater for “${query}” i ${current.title}`;
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
$("#browseBack").addEventListener("click", () => {
  if (state.browseStack.length <= 1) return;
  state.browseStack.pop();
  browseFolder(state.browseStack.at(-1), false);
});

$("#mediaServer").addEventListener("change", () => {
  const server = state.config.mediaServers.find((item) => item.id === $("#mediaServer").value);
  $("#libraryName").textContent = server?.name || "INGEN SERVER";
  $("#searchResults").replaceChildren();
  $("#pagination").hidden = true;
  $("#backToSearch").hidden = true;
  if (state.libraryMode === "browse" && server) {
    state.browseStack = [{ id: "0", title: server.name }];
    browseFolder(state.browseStack[0], false);
  } else {
    $("#searchStatus").textContent = server ? `Søg blandt musikken på ${server.name}.` : "Tilføj en medieserver i indstillinger.";
  }
});

function addServerSettingsRow(server = {}) {
  const row = document.createElement("div");
  row.className = "server-setting-row";
  row.dataset.id = server.id || crypto.randomUUID();
  const name = document.createElement("input");
  name.className = "settings-input server-name";
  name.placeholder = "Navn, fx Medieserver";
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
  remove.ariaLabel = "Fjern medieserver";
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
  name.placeholder = "Stationsnavn";
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
  artwork.placeholder = "Logo-URL (valgfri)";
  artwork.value = radio.artwork || "";
  const remove = document.createElement("button");
  remove.className = "remove-button";
  remove.type = "button";
  remove.ariaLabel = `Fjern ${radio.name || "radiostation"}`;
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
  $("#spotifyRedirectNotice").textContent = url.protocol === "http:" && !loopback
    ? "Spotify kræver HTTPS for offentlige domæner og adresser på lokalnetværket. Brug HTTPS eller konfigurér SPOTIFY_REDIRECT_URI til din offentlige HTTPS-adresse."
    : loopback ? "Ved lokal brug kræver Spotify en loopback-IP som 127.0.0.1 frem for localhost." : "Sørg for, at denne HTTPS-adresse også står i Spotify Dashboard.";
}

function openSettings() {
  if (!state.config) return;
  $("#settingsDeviceIp").value = state.config.deviceIp;
  $("#spotifyClientId").value = "";
  $("#spotifyClientId").placeholder = state.config.spotifyConfigured ? "Konfigureret via .env" : "Mangler SPOTIFY_CLIENT_ID i .env";
  $("#serverSettings").replaceChildren();
  state.config.mediaServers.forEach(addServerSettingsRow);
  document.querySelectorAll("#serverSettings input, #serverSettings button").forEach((element) => {
    element.disabled = true;
  });
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
$("#addRadio").addEventListener("click", () => addRadioSettingsRow());
$("#settingsDialog").addEventListener("click", (event) => {
  if (event.target === $("#settingsDialog")) $("#settingsDialog").close();
});
$("#spotifyHelpDialog").addEventListener("click", (event) => {
  if (event.target === $("#spotifyHelpDialog")) $("#spotifyHelpDialog").close();
});
$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const radios = [...document.querySelectorAll(".radio-setting-row")].map((row) => ({
    id: row.dataset.id,
    name: row.querySelector(".radio-setting-name").value,
    url: row.querySelector(".radio-setting-url").value,
    artwork: row.querySelector(".radio-setting-artwork").value || null,
    rating: state.config.radios.find((radio) => radio.id === row.dataset.id)?.rating || 0,
  }));
  try {
    await saveConfiguration({
      ...state.config,
      radios,
    });
    $("#settingsDialog").close();
    notify("Radioindstillingerne er gemt");
    refreshStatus();
    loadDevice();
  } catch (error) {
    notify(error.message);
  }
});

setRange($("#volume"), Number($("#volume").value), 100);

async function initialize() {
  await refreshStatus();
  await Promise.all([loadConfiguration(), loadDevice()]);
  setInterval(refreshStatus, 2000);
}

initialize();
