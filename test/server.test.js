const assert = require("node:assert/strict");
const test = require("node:test");

const { currentPlayerStatus, parseMediaResponse, spotifyPlayerStatus, unknownDirectPlaybackStatus } = require("../server");

function soapResponse(didl) {
  const result = didl.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<s:Envelope><s:Body><Result>${result}</Result><TotalMatches>2</TotalMatches></s:Body></s:Envelope>`;
}

test("parseMediaResponse resolves artwork for album containers", () => {
  const didl = `
    <DIDL-Lite>
      <container id="album-1" childCount="12">
        <dc:title>Test Album</dc:title>
        <upnp:class>object.container.album.musicAlbum</upnp:class>
        <upnp:albumArtURI>/AlbumArt/album-1.jpg</upnp:albumArtURI>
      </container>
      <item id="track-1">
        <dc:title>Test Track</dc:title>
        <upnp:class>object.item.audioItem.musicTrack</upnp:class>
        <res>http://192.168.0.10:8200/MediaItems/track-1.mp3</res>
        <upnp:albumArtURI>http://192.168.0.10:8200/AlbumArt/album-1.jpg</upnp:albumArtURI>
      </item>
    </DIDL-Lite>`;

  const result = parseMediaResponse(soapResponse(didl), "http://192.168.0.10:8200");

  assert.equal(result.containers[0].artwork, "http://192.168.0.10:8200/AlbumArt/album-1.jpg");
  assert.equal(result.items[0].artwork, "http://192.168.0.10:8200/AlbumArt/album-1.jpg");
});

test("parseMediaResponse rejects non-HTTP artwork URLs", () => {
  const didl = `
    <DIDL-Lite>
      <container id="folder-1">
        <dc:title>Folder</dc:title>
        <upnp:albumArtURI>data:image/png;base64,unsafe</upnp:albumArtURI>
      </container>
    </DIDL-Lite>`;

  const result = parseMediaResponse(soapResponse(didl), "http://192.168.0.10:8200");

  assert.equal(result.containers[0].artwork, null);
});

test("currentPlayerStatus keeps persisted local stream metadata", () => {
  const playback = { Title: "Previous track", Artist: "Previous artist", startedAt: 1000 };
  const status = { mode: "10", status: "play", Title: "Current track", Artist: "Current artist" };

  assert.deepEqual(currentPlayerStatus(status, playback, 7000), {
    ...status,
    Title: "Previous track",
    Artist: "Previous artist",
  });
});

test("currentPlayerStatus supplies local metadata immediately", () => {
  const playback = { Title: "New track", Artist: "New artist", startedAt: 1000 };
  const status = { mode: "10", status: "play", Title: "Previous track", Artist: "Previous artist" };

  assert.deepEqual(currentPlayerStatus(status, playback, 2000), {
    ...status,
    Title: "New track",
    Artist: "New artist",
  });
});

test("spotifyPlayerStatus uses the current track on the iEast device", () => {
  const playback = {
    is_playing: true,
    progress_ms: 12000,
    device: { name: "Musik å æ slot" },
    item: {
      type: "track",
      uri: "spotify:track:123",
      name: "Georgia",
      duration_ms: 240000,
      artists: [{ name: "Elton John" }],
      album: { name: "Elton John", images: [{ url: "https://example.com/cover.jpg" }] },
    },
  };

  assert.deepEqual(spotifyPlayerStatus(playback, "Musik å æ slot"), {
    status: "play",
    curpos: 12000,
    totlen: 240000,
    Title: "Georgia",
    Artist: "Elton John",
    Album: "Elton John",
    artwork: "https://example.com/cover.jpg",
    spotifyUri: "spotify:track:123",
    mediaType: "track",
  });
});

test("spotifyPlayerStatus ignores playback on another device", () => {
  const playback = {
    is_playing: true,
    device: { name: "Telefon" },
    item: { type: "track", name: "Georgia" },
  };

  assert.equal(spotifyPlayerStatus(playback, "Musik å æ slot"), null);
});

test("unknownDirectPlaybackStatus hides stale iEast metadata", () => {
  const status = { mode: "10", status: "play", Title: "Stale track", Artist: "Stale artist" };

  assert.deepEqual(unknownDirectPlaybackStatus(status, false), {
    ...status,
    Title: "Ekstern afspilning",
    Artist: "Vælg nummeret i controlleren for at vise metadata",
    Album: "",
    artwork: null,
    disableArtwork: true,
  });
  assert.equal(unknownDirectPlaybackStatus(status, true), status);
});
