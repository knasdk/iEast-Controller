# iEast Controller

A lightweight web controller for iEast and other LinkPlay-based audio streamers. It provides one browser interface for playback controls, internet radio, local DLNA music libraries, and Spotify Connect.

The application is a dependency-free Node.js server with a responsive frontend. It is intended to run on the same private network as the streamer and any DLNA servers.

## Features

- Control playback, volume, mute, seeking, and track navigation
- Display current track metadata and artwork
- Search and browse one or more DLNA/UPnP media servers
- Play and manage internet radio stations
- Rate and sort radio stations
- Search Spotify for tracks, albums, artists, and playlists
- Browse Spotify albums and send playback to a Spotify Connect device
- Configure private deployment values through environment variables
- Run without a database or npm dependencies

## Requirements

- Node.js 18 or newer
- An iEast or compatible LinkPlay streamer reachable from the server
- Optional: a DLNA/UPnP media server such as MiniDLNA
- Optional: a Spotify Premium account and Spotify Developer app

## Quick Start

1. Clone or download the repository.
2. Enter the project directory.
3. Create your private environment file:

```bash
cp .env.example .env
```

4. Edit `.env` with your streamer and media server details.
5. Start the application:

```bash
npm start
```

6. Open <http://localhost:3000> in a browser.

No `npm install` step is required because the project only uses built-in Node.js modules.

## Configuration

The application loads `.env` from the project root. Real environment variables take precedence over values in that file.

```dotenv
HOST=0.0.0.0
PORT=3000

IEAST_IP=192.168.1.100

MEDIA_SERVERS=[{"id":"music","name":"Music library","url":"http://192.168.1.101:8200"}]

SPOTIFY_CLIENT_ID=
SPOTIFY_REDIRECT_URI=

# Optional persistent volume; defaults to .state inside the project
# STATE_DIR=/var/lib/ieast-controller
```

| Variable | Required | Description |
| --- | --- | --- |
| `HOST` | No | Address the HTTP server listens on. Defaults to `0.0.0.0`. |
| `PORT` | No | HTTP port. Defaults to `3000`. |
| `IEAST_IP` | Yes | Local IPv4 address of the iEast/LinkPlay streamer. |
| `MEDIA_SERVERS` | No | JSON array of DLNA servers. Each entry requires `id`, `name`, and `url`. |
| `SPOTIFY_CLIENT_ID` | For Spotify | Client ID from the Spotify Developer Dashboard. |
| `SPOTIFY_REDIRECT_URI` | No | Fixed OAuth callback URL, normally used behind a reverse proxy. |
| `STATE_DIR` | No | Directory for OAuth tokens and radio settings. Defaults to `.state` in the project. |

Multiple DLNA servers can be configured in one line:

```dotenv
MEDIA_SERVERS=[{"id":"nas","name":"Home NAS","url":"http://192.168.1.101:8200"},{"id":"office","name":"Office library","url":"http://192.168.1.102:8200"}]
```

The iEast address, media servers, and Spotify Client ID are intentionally read-only in the web settings because they are managed through `.env`.

## Spotify Setup

Spotify playback control requires Spotify Premium. This project uses OAuth with PKCE, so a Client Secret is not required.

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and sign in.
2. Select **Create app**.
3. Enter an app name and description.
4. Add the redirect URI shown under **Settings → Spotify Client ID** in iEast Controller.
5. For local use, the URI is normally:

```text
http://127.0.0.1:3000/api/spotify/callback
```

6. Select **Web API**, accept Spotify's terms, and create the app.
7. Copy the app's **Client ID** into `SPOTIFY_CLIENT_ID` in `.env`.
8. Restart iEast Controller.
9. Open the Spotify tab and select **Connect Spotify**.

The redirect URI in Spotify must match exactly. Spotify permits plain HTTP for loopback IP addresses such as `127.0.0.1`, but deployed domains and non-loopback addresses should use HTTPS.

## State And Persistence

On first start, the application automatically creates `.state/` in the project directory. It stores:

- Radio changes and star ratings in `.state/settings.json`
- Spotify OAuth tokens in `.state/spotify.json`

The entire `.state/` directory is excluded by `.gitignore`, so runtime data and tokens are never committed. To use a persistent volume on a deployed instance, point `STATE_DIR` at its mounted path:

```dotenv
STATE_DIR=/var/lib/ieast-controller
```

The server creates the directory and state files automatically with restrictive permissions. Do not remove `.state/` from `.gitignore` or copy its Spotify token into Git.

## Deployment

The server can run directly with `npm start` or behind a reverse proxy. When using a reverse proxy:

- Forward `X-Forwarded-Proto` and `X-Forwarded-Host`.
- Use HTTPS for the public URL.
- Set an explicit callback if proxy headers are unavailable:

```dotenv
SPOTIFY_REDIRECT_URI=https://music.example.com/api/spotify/callback
```

- Add exactly the same URL to the Spotify Developer Dashboard.
- On ephemeral hosting, mount a persistent directory and set `STATE_DIR` to that path.
- Ensure the deployed server can route to the streamer's and DLNA servers' private IP addresses.

> [!WARNING]
> iEast Controller does not include user authentication. Do not expose it directly to the public internet. Use a private network, VPN, or an authenticated reverse proxy.

## Using The Controller

- Use the player at the top for transport, seek, volume, and mute controls.
- Use **Search** to find music across the selected DLNA server.
- Use **Browse** to navigate the DLNA folder hierarchy.
- Use **Spotify** to connect an account, choose a Connect device, and search Spotify.
- Use the radio section to play, rate, and filter stations.
- Open the gear icon to view environment-managed settings and edit radio stations.

## Troubleshooting

### The streamer cannot be reached

- Confirm `IEAST_IP` is correct.
- Confirm the Node.js server and streamer can reach each other on the same network or VPN.
- Check that no firewall blocks access to the streamer.

### The DLNA library is empty or unavailable

- Confirm the URL in `MEDIA_SERVERS` is reachable from the Node.js server.
- MiniDLNA commonly uses port `8200`.
- Validate that `MEDIA_SERVERS` is valid JSON on a single line.

### Spotify reports a redirect URI error

- Copy the URI shown in the application's Spotify tutorial.
- Confirm the URI matches the Spotify Dashboard entry exactly, including protocol, hostname, port, and path.
- Use `127.0.0.1` instead of `localhost` for local Spotify setup.
- Use HTTPS when deploying on a hostname or non-loopback IP address.

### Spotify login disappears after deployment or restart

Confirm that `.state/` survives restarts. On ephemeral hosting, configure `STATE_DIR` to use a persistent volume.

### No Spotify Connect devices are shown

- Open Spotify on the target device or another Spotify client first.
- Confirm the device uses the same Spotify account.
- Confirm the account has Spotify Premium.

## Security

- `.env` is excluded by `.gitignore`.
- `.env.example` contains placeholders only and is safe to commit.
- Spotify uses PKCE and does not require a Client Secret.
- OAuth tokens are never sent to the browser.
- `.state/` is ignored, so the repository contains no OAuth tokens or runtime state.

Before committing, verify the file list:

```bash
git status --short
git check-ignore -v .env
```

## Project Structure

```text
.
├── .env.example       # Safe configuration template
├── public/
│   ├── app.js         # Browser application
│   ├── index.html     # User interface
│   └── styles.css     # Responsive styling
├── server.js          # HTTP API, LinkPlay, DLNA, and Spotify integration
├── package.json
└── README.md
```

## License

No license has been added yet. Add a license before distributing or accepting external contributions.
