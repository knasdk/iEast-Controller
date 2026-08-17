(function () {
  "use strict";

  const localeNames = { da: "Dansk", en: "English", sv: "Svenska", nb: "Norsk", de: "Deutsch" };
  const rows = {
    "app.title": ["iEast Controller", "iEast Controller", "iEast Controller", "iEast Controller", "iEast Controller"],
    "product.ieast": ["iEast", "iEast", "iEast", "iEast", "iEast"],
    "product.recordMark": ["IE", "IE", "IE", "IE", "IE"],
    "common.loading": ["Indlæser...", "Loading...", "Läser in...", "Laster...", "Wird geladen..."],
    "common.add": ["+ Tilføj", "+ Add", "+ Lägg till", "+ Legg til", "+ Hinzufügen"],
    "common.cancel": ["Annuller", "Cancel", "Avbryt", "Avbryt", "Abbrechen"],
    "common.close": ["Luk", "Close", "Stäng", "Lukk", "Schließen"],
    "common.search": ["Søg", "Search", "Sök", "Søk", "Suchen"],
    "common.album": ["Album", "Album", "Album", "Album", "Album"],
    "common.track": ["Nummer", "Track", "Låt", "Spor", "Titel"],
    "common.folder": ["Mappe", "Folder", "Mapp", "Mappe", "Ordner"],
    "common.mediaServer": ["Medieserver", "Media server", "Medieserver", "Medieserver", "Medienserver"],
    "common.mediaServerUpper": ["MEDIESERVER", "MEDIA SERVER", "MEDIESERVER", "MEDIESERVER", "MEDIENSERVER"],
    "common.radio": ["Radio", "Radio", "Radio", "Radio", "Radio"],
    "common.noServer": ["INGEN SERVER", "NO SERVER", "INGEN SERVER", "INGEN SERVER", "KEIN SERVER"],
    "common.unknownArtist": ["Ukendt kunstner", "Unknown artist", "Okänd artist", "Ukjent artist", "Unbekannter Künstler"],
    "common.unknownAlbum": ["Ukendt album", "Unknown album", "Okänt album", "Ukjent album", "Unbekanntes Album"],
    "common.unknownTrack": ["Ukendt nummer", "Unknown track", "Okänd låt", "Ukjent spor", "Unbekannter Titel"],
    "common.unknownTitle": ["Ukendt titel", "Unknown title", "Okänd titel", "Ukjent tittel", "Unbekannter Titel"],
    "connection.connecting": ["Forbinder...", "Connecting...", "Ansluter...", "Kobler til...", "Verbindung wird hergestellt..."],
    "connection.connected": ["Forbundet", "Connected", "Ansluten", "Tilkoblet", "Verbunden"],
    "connection.offline": ["Ingen forbindelse", "No connection", "Ingen anslutning", "Ingen tilkobling", "Keine Verbindung"],
    "connection.status": ["Status", "Status", "Status", "Status", "Status"],
    "settings.open": ["Åbn indstillinger", "Open settings", "Öppna inställningar", "Åpne innstillinger", "Einstellungen öffnen"],
    "player.ready": ["Klar til musik", "Ready for music", "Redo för musik", "Klar for musikk", "Bereit für Musik"],
    "player.choose": ["Vælg en stream eller start afspilning", "Choose a stream or start playback", "Välj en ström eller starta uppspelning", "Velg en strøm eller start avspilling", "Stream wählen oder Wiedergabe starten"],
    "player.streamer": ["IEAST STREAMER", "IEAST STREAMER", "IEAST STREAMER", "IEAST STREAMER", "IEAST STREAMER"],
    "player.nowPlaying": ["AFSPILLER NU", "NOW PLAYING", "SPELAR NU", "SPILLER NÅ", "AKTUELLE WIEDERGABE"],
    "player.position": ["Position", "Position", "Position", "Posisjon", "Position"],
    "player.controls": ["Afspilningsknapper", "Playback controls", "Uppspelningsknappar", "Avspillingsknapper", "Wiedergabesteuerung"],
    "player.previous": ["Forrige nummer", "Previous track", "Föregående låt", "Forrige spor", "Vorheriger Titel"],
    "player.next": ["Næste nummer", "Next track", "Nästa låt", "Neste spor", "Nächster Titel"],
    "player.play": ["Afspil", "Play", "Spela", "Spill av", "Abspielen"],
    "player.pause": ["Pause", "Pause", "Pausa", "Pause", "Pause"],
    "player.pauseItem": ["Sæt {title} på pause", "Pause {title}", "Pausa {title}", "Sett {title} på pause", "{title} pausieren"],
    "player.resumeItem": ["Fortsæt {title}", "Resume {title}", "Fortsätt {title}", "Fortsett {title}", "{title} fortsetzen"],
    "player.playItem": ["Afspil {title}", "Play {title}", "Spela {title}", "Spill av {title}", "{title} abspielen"],
    "player.playingItem": ["Afspiller {title}", "Playing {title}", "Spelar {title}", "Spiller {title}", "{title} wird abgespielt"],
    "player.playingOn": ["Afspiller {title} på {device}", "Playing {title} on {device}", "Spelar {title} på {device}", "Spiller {title} på {device}", "{title} wird auf {device} abgespielt"],
    "player.mute": ["Slå lyden fra", "Mute", "Stäng av ljudet", "Demp lyden", "Stummschalten"],
    "player.unmute": ["Slå lyden til", "Unmute", "Slå på ljudet", "Slå på lyden", "Stummschaltung aufheben"],
    "player.volume": ["Lydstyrke", "Volume", "Volym", "Volum", "Lautstärke"],
    "player.tone": ["Tonekontroller", "Tone controls", "Tonkontroller", "Tonekontroller", "Klangregler"],
    "player.bass": ["Bas", "Bass", "Bas", "Bass", "Bass"],
    "player.treble": ["Diskant", "Treble", "Diskant", "Diskant", "Höhen"],
    "player.coverAlt": ["Cover til {title}", "Cover for {title}", "Omslag till {title}", "Omslag for {title}", "Cover von {title}"],
    "player.externalPlayback": ["Ekstern afspilning", "External playback", "Extern uppspelning", "Ekstern avspilling", "Externe Wiedergabe"],
    "player.metadataPrompt": ["Vælg nummeret i controlleren for at vise metadata", "Select the track in the controller to show metadata", "Välj låten i kontrollen för att visa metadata", "Velg sporet i kontrolleren for å vise metadata", "Wähle den Titel im Controller, um Metadaten anzuzeigen"],
    "queue.eyebrow": ["AFSPILNING", "PLAYBACK", "UPPSPELNING", "AVSPILLING", "WIEDERGABE"],
    "queue.title": ["Aktuel kø", "Current queue", "Aktuell kö", "Gjeldende kø", "Aktuelle Warteschlange"],
    "queue.empty": ["Køen er tom", "The queue is empty", "Kön är tom", "Køen er tom", "Die Warteschlange ist leer"],
    "queue.summary": ["{current} af {count} · {state}", "{current} of {count} · {state}", "{current} av {count} · {state}", "{current} av {count} · {state}", "{current} von {count} · {state}"],
    "queue.state.playing": ["afspiller", "playing", "spelar", "spiller", "wird abgespielt"],
    "queue.state.paused": ["pause", "paused", "pausad", "pauset", "pausiert"],
    "queue.state.stopped": ["stoppet", "stopped", "stoppad", "stoppet", "gestoppt"],
    "queue.autoNext": ["Næste nummer automatisk", "Next track automatically", "Nästa låt automatiskt", "Neste spor automatisk", "Nächsten Titel automatisch"],
    "queue.continueAlbums": ["Fortsæt med næste album", "Continue with next album", "Fortsätt med nästa album", "Fortsett med neste album", "Mit nächstem Album fortfahren"],
    "queue.shuffleLabel": ["Bland køens rækkefølge", "Shuffle queue order", "Blanda köns ordning", "Bland køens rekkefølge", "Reihenfolge mischen"],
    "queue.shuffle": ["Bland", "Shuffle", "Blanda", "Bland", "Mischen"],
    "queue.reset": ["Nulstil", "Reset", "Återställ", "Nullstill", "Zurücksetzen"],
    "queue.clear": ["Ryd aktuel kø", "Clear current queue", "Rensa aktuell kö", "Tøm gjeldende kø", "Aktuelle Warteschlange leeren"],
    "queue.appended": ["Valget er føjet til køen", "Selection added to queue", "Valet har lagts till i kön", "Valget er lagt til i køen", "Auswahl wurde hinzugefügt"],
    "queue.playingSelection": ["Afspiller valget", "Playing selection", "Spelar valet", "Spiller valget", "Auswahl wird abgespielt"],
    "toggle.off": ["Fra", "Off", "Av", "Av", "Aus"],
    "toggle.on": ["Til", "On", "På", "På", "Ein"],
    "selection.add": ["Til liste", "Add", "Till lista", "Til liste", "Hinzufügen"],
    "selection.added": ["På liste", "Added", "På lista", "På liste", "Hinzugefügt"],
    "selection.none": ["Ingen valgte", "None selected", "Inga valda", "Ingen valgt", "Nichts ausgewählt"],
    "selection.count": ["{count} valgt", "{count} selected", "{count} vald", "{count} valgt", "{count} ausgewählt"],
    "selection.count_other": ["{count} valgte", "{count} selected", "{count} valda", "{count} valgt", "{count} ausgewählt"],
    "selection.track": ["Vælg nummer", "Select track", "Välj låt", "Velg spor", "Titel auswählen"],
    "selection.album": ["Vælg album", "Select album", "Välj album", "Velg album", "Album auswählen"],
    "selection.play": ["Afspil valgte", "Play selected", "Spela valda", "Spill av valgte", "Auswahl abspielen"],
    "selection.append": ["Føj til kø", "Add to queue", "Lägg till i kön", "Legg til i kø", "Zur Warteschlange hinzufügen"],
    "playlists.eyebrow": ["GEMT MUSIK", "SAVED MUSIC", "SPARAD MUSIK", "LAGRET MUSIKK", "GESPEICHERTE MUSIK"],
    "playlists.title": ["Afspilningslister", "Playlists", "Spellistor", "Spillelister", "Wiedergabelisten"],
    "playlists.none": ["Ingen gemte lister", "No saved playlists", "Inga sparade listor", "Ingen lagrede lister", "Keine gespeicherten Listen"],
    "playlists.savedLabel": ["Gemt afspilningsliste", "Saved playlist", "Sparad spellista", "Lagret spilleliste", "Gespeicherte Wiedergabeliste"],
    "playlists.shuffle": ["Bland", "Shuffle", "Blanda", "Bland", "Zufällig"],
    "playlists.play": ["Afspil liste", "Play playlist", "Spela lista", "Spill av liste", "Liste abspielen"],
    "playlists.update": ["Opdater liste", "Update playlist", "Uppdatera lista", "Oppdater liste", "Liste aktualisieren"],
    "playlists.delete": ["Slet liste", "Delete playlist", "Ta bort lista", "Slett liste", "Liste löschen"],
    "playlists.emptyPrompt": ["Vælg eller opret en afspilningsliste for at se indholdet.", "Select or create a playlist to see its contents.", "Välj eller skapa en spellista för att se innehållet.", "Velg eller opprett en spilleliste for å se innholdet.", "Wähle oder erstelle eine Wiedergabeliste, um ihren Inhalt zu sehen."],
    "playlists.entryCount": ["{count} post", "{count} entry", "{count} post", "{count} oppføring", "{count} Eintrag"],
    "playlists.entryCount_other": ["{count} poster", "{count} entries", "{count} poster", "{count} oppføringer", "{count} Einträge"],
    "playlists.wholeAlbum": ["Hele albummet", "Entire album", "Hela albumet", "Hele albumet", "Ganzes Album"],
    "playlists.namePlaceholder": ["Navn på liste", "Playlist name", "Namn på lista", "Navn på liste", "Name der Liste"],
    "playlists.nameLabel": ["Navn på afspilningsliste", "Playlist name", "Spellistans namn", "Navn på spilleliste", "Name der Wiedergabeliste"],
    "playlists.save": ["Gem liste", "Save playlist", "Spara lista", "Lagre liste", "Liste speichern"],
    "playlists.saved": ["Afspilningslisten er gemt", "Playlist saved", "Spellistan har sparats", "Spillelisten er lagret", "Wiedergabeliste gespeichert"],
    "playlists.updated": ["Afspilningslisten og den aktuelle kø er opdateret", "Playlist and current queue updated", "Spellistan och den aktuella kön har uppdaterats", "Spillelisten og gjeldende kø er oppdatert", "Wiedergabeliste und Warteschlange aktualisiert"],
    "playlists.deleted": ["Afspilningslisten er slettet", "Playlist deleted", "Spellistan har tagits bort", "Spillelisten er slettet", "Wiedergabeliste gelöscht"],
    "library.eyebrow": ["MUSIKBIBLIOTEK", "MUSIC LIBRARY", "MUSIKBIBLIOTEK", "MUSIKKBIBLIOTEK", "MUSIKBIBLIOTHEK"],
    "library.title": ["Find din næste sang", "Find your next song", "Hitta din nästa låt", "Finn din neste sang", "Finde deinen nächsten Song"],
    "library.searchTab": ["Søg", "Search", "Sök", "Søk", "Suche"],
    "library.browseTab": ["Mapper", "Folders", "Mappar", "Mapper", "Ordner"],
    "library.spotifyTab": ["Spotify", "Spotify", "Spotify", "Spotify", "Spotify"],
    "library.viewLabel": ["Biblioteksvisning", "Library view", "Biblioteksvy", "Bibliotekvisning", "Bibliotheksansicht"],
    "library.chooseServer": ["Vælg medieserver", "Choose media server", "Välj medieserver", "Velg medieserver", "Medienserver wählen"],
    "library.chooseSpotifyDevice": ["Vælg Spotify Connect-enhed", "Choose Spotify Connect device", "Välj Spotify Connect-enhet", "Velg Spotify Connect-enhet", "Spotify-Connect-Gerät wählen"],
    "library.searchMusic": ["Søg efter musik", "Search for music", "Sök efter musik", "Søk etter musikk", "Nach Musik suchen"],
    "library.searchPlaceholder": ["Søg efter titel, artist eller album", "Search by title, artist, or album", "Sök efter titel, artist eller album", "Søk etter tittel, artist eller album", "Nach Titel, Künstler oder Album suchen"],
    "library.searchSpotifyPlaceholder": ["Søg efter musik på Spotify", "Search for music on Spotify", "Sök efter musik på Spotify", "Søk etter musikk på Spotify", "Auf Spotify nach Musik suchen"],
    "library.searchFolderPlaceholder": ["Søg i denne mappe", "Search this folder", "Sök i den här mappen", "Søk i denne mappen", "Diesen Ordner durchsuchen"],
    "library.localPrompt": ["Søg blandt musikken på din lokale medieserver.", "Search the music on your local media server.", "Sök bland musiken på din lokala medieserver.", "Søk i musikken på den lokale medieserveren.", "Musik auf deinem lokalen Medienserver durchsuchen."],
    "library.searchPrompt": ["Søg efter titel, artist eller album.", "Search by title, artist, or album.", "Sök efter titel, artist eller album.", "Søk etter tittel, artist eller album.", "Nach Titel, Künstler oder Album suchen."],
    "library.searchServer": ["Søg blandt musikken på {server}.", "Search the music on {server}.", "Sök bland musiken på {server}.", "Søk i musikken på {server}.", "Musik auf {server} durchsuchen."],
    "library.addServerPrompt": ["Tilføj en medieserver i indstillinger.", "Add a media server in settings.", "Lägg till en medieserver i inställningarna.", "Legg til en medieserver i innstillingene.", "Füge in den Einstellungen einen Medienserver hinzu."],
    "library.browseTitle": ["Gennemse mapper", "Browse folders", "Bläddra bland mappar", "Bla gjennom mapper", "Ordner durchsuchen"],
    "library.spotifyTitle": ["Søg på Spotify", "Search Spotify", "Sök på Spotify", "Søk på Spotify", "Spotify durchsuchen"],
    "library.up": ["← Et niveau op", "← Up one level", "← En nivå upp", "← Ett nivå opp", "← Eine Ebene höher"],
    "library.backResults": ["← Tilbage til søgeresultater", "← Back to search results", "← Tillbaka till sökresultaten", "← Tilbake til søkeresultater", "← Zurück zu den Suchergebnissen"],
    "library.pages": ["Sider", "Pages", "Sidor", "Sider", "Seiten"],
    "library.fetching": ["Henter {name}...", "Loading {name}...", "Hämtar {name}...", "Henter {name}...", "{name} wird geladen..."],
    "library.browseSummary": ["{folders} mapper · {files} lydfiler på {server}", "{folders} folders · {files} audio files on {server}", "{folders} mappar · {files} ljudfiler på {server}", "{folders} mapper · {files} lydfiler på {server}", "{folders} Ordner · {files} Audiodateien auf {server}"],
    "library.folderItems": ["{count} elementer", "{count} items", "{count} objekt", "{count} elementer", "{count} Elemente"],
    "library.unnamedFolder": ["Unavngiven mappe", "Unnamed folder", "Namnlös mapp", "Mappe uten navn", "Unbenannter Ordner"],
    "library.searching": ["Søger efter “{query}”...", "Searching for “{query}”...", "Söker efter ”{query}”...", "Søker etter «{query}»...", "Suche nach „{query}“..."],
    "library.searchingFolder": ["Søger i {folder} efter “{query}”...", "Searching {folder} for “{query}”...", "Söker i {folder} efter ”{query}”...", "Søker i {folder} etter «{query}»...", "Suche in {folder} nach „{query}“..."],
    "library.results": ["Side {page} af {pages} · {count} resultater på {server}", "Page {page} of {pages} · {count} results on {server}", "Sida {page} av {pages} · {count} resultat på {server}", "Side {page} av {pages} · {count} resultater på {server}", "Seite {page} von {pages} · {count} Ergebnisse auf {server}"],
    "library.folderResults": ["Side {page} af {pages} · {count} resultater i {folder}", "Page {page} of {pages} · {count} results in {folder}", "Sida {page} av {pages} · {count} resultat i {folder}", "Side {page} av {pages} · {count} resultater i {folder}", "Seite {page} von {pages} · {count} Ergebnisse in {folder}"],
    "library.noResults": ["Ingen resultater for “{query}”", "No results for “{query}”", "Inga resultat för ”{query}”", "Ingen resultater for «{query}»", "Keine Ergebnisse für „{query}“"],
    "library.noFolderResults": ["Ingen resultater for “{query}” i {folder}", "No results for “{query}” in {folder}", "Inga resultat för ”{query}” i {folder}", "Ingen resultater for «{query}» i {folder}", "Keine Ergebnisse für „{query}“ in {folder}"],
    "library.loadingAlbum": ["Henter albummet “{album}”...", "Loading album “{album}”...", "Hämtar albumet ”{album}”...", "Henter albumet «{album}»...", "Album „{album}“ wird geladen..."],
    "library.albumSummary": ["{album} · {count} numre på {server}", "{album} · {count} tracks on {server}", "{album} · {count} låtar på {server}", "{album} · {count} spor på {server}", "{album} · {count} Titel auf {server}"],
    "library.noServerAlbum": ["Der er ingen medieserver at åbne albummet på", "There is no media server available to open the album", "Det finns ingen medieserver att öppna albumet på", "Det finnes ingen medieserver å åpne albumet på", "Zum Öffnen des Albums ist kein Medienserver verfügbar"],
    "library.noServerTrack": ["Der er ingen medieserver at finde nummeret på", "There is no media server available to find the track", "Det finns ingen medieserver att hitta låten på", "Det finnes ingen medieserver å finne sporet på", "Zum Finden des Titels ist kein Medienserver verfügbar"],
    "library.folderNotFound": ["Nummerets mappe kunne ikke findes", "The track's folder could not be found", "Låtens mapp kunde inte hittas", "Sporets mappe ble ikke funnet", "Der Ordner des Titels wurde nicht gefunden"],
    "radio.eyebrow": ["RADIO", "RADIO", "RADIO", "RADIO", "RADIO"],
    "radio.title": ["Mine stationer", "My stations", "Mina stationer", "Mine stasjoner", "Meine Sender"],
    "radio.description": ["Start en gemt radiostation med ét klik. Stationer administreres under Indstillinger.", "Start a saved radio station with one click. Manage stations in Settings.", "Starta en sparad radiostation med ett klick. Hantera stationer under Inställningar.", "Start en lagret radiostasjon med ett klikk. Administrer stasjoner under Innstillinger.", "Starte einen gespeicherten Radiosender mit einem Klick. Sender werden unter Einstellungen verwaltet."],
    "radio.none": ["Ingen gemte stationer endnu.", "No saved stations yet.", "Inga sparade stationer än.", "Ingen lagrede stasjoner ennå.", "Noch keine Sender gespeichert."],
    "radio.rating": ["Bedømmelse af {name}", "Rating for {name}", "Betyg för {name}", "Vurdering av {name}", "Bewertung für {name}"],
    "radio.stars": ["{count} stjerne", "{count} star", "{count} stjärna", "{count} stjerne", "{count} Stern"],
    "radio.stars_other": ["{count} stjerner", "{count} stars", "{count} stjärnor", "{count} stjerner", "{count} Sterne"],
    "radio.remove": ["Fjern {name}", "Remove {name}", "Ta bort {name}", "Fjern {name}", "{name} entfernen"],
    "radio.station": ["radiostation", "radio station", "radiostation", "radiostasjon", "Radiosender"],
    "radio.namePlaceholder": ["Stationsnavn", "Station name", "Stationsnamn", "Stasjonsnavn", "Sendername"],
    "radio.logoPlaceholder": ["Logo-URL (valgfri)", "Logo URL (optional)", "Logotyp-URL (valfritt)", "Logo-URL (valgfri)", "Logo-URL (optional)"],
    "device.eyebrow": ["ENHED", "DEVICE", "ENHET", "ENHET", "GERÄT"],
    "device.ip": ["IP-adresse", "IP address", "IP-adress", "IP-adresse", "IP-Adresse"],
    "device.signal": ["Wi-Fi signal", "Wi-Fi signal", "Wi-Fi-signal", "Wi-Fi-signal", "WLAN-Signal"],
    "device.firmware": ["Firmware", "Firmware", "Firmware", "Fastvare", "Firmware"],
    "settings.eyebrow": ["KONFIGURATION", "CONFIGURATION", "KONFIGURATION", "KONFIGURASJON", "KONFIGURATION"],
    "settings.title": ["Indstillinger", "Settings", "Inställningar", "Innstillinger", "Einstellungen"],
    "settings.deviceIp": ["iEast IP-adresse", "iEast IP address", "iEast IP-adress", "iEast IP-adresse", "iEast-IP-Adresse"],
    "settings.deviceIpHelp": ["Den lokale IPv4-adresse på din iEast-enhed.", "The local IPv4 address of your iEast device.", "Den lokala IPv4-adressen till din iEast-enhet.", "Den lokale IPv4-adressen til iEast-enheten.", "Die lokale IPv4-Adresse deines iEast-Geräts."],
    "settings.language": ["Sprog", "Language", "Språk", "Språk", "Sprache"],
    "settings.languageHelp": ["Sproget gemmes sammen med konfigurationen.", "The language is saved with the configuration.", "Språket sparas med konfigurationen.", "Språket lagres med konfigurasjonen.", "Die Sprache wird mit der Konfiguration gespeichert."],
    "settings.spotifyClientIdOptional": ["Valgfrit Client ID", "Optional Client ID", "Valfritt Client ID", "Valgfri Client ID", "Optionale Client ID"],
    "settings.spotifyClientId": ["Spotify Client ID", "Spotify Client ID", "Spotify Client ID", "Spotify Client ID", "Spotify Client ID"],
    "settings.redirectHelp": ["Redirect URI i Spotify Dashboard:", "Redirect URI in Spotify Dashboard:", "Redirect URI i Spotify Dashboard:", "Redirect URI i Spotify Dashboard:", "Redirect URI im Spotify Dashboard:"],
    "settings.mediaServers": ["Medieservere", "Media servers", "Medieservrar", "Medieservere", "Medienserver"],
    "settings.mediaServersHelp": ["Lokale DLNA/UPnP-servere", "Local DLNA/UPnP servers", "Lokala DLNA/UPnP-servrar", "Lokale DLNA/UPnP-servere", "Lokale DLNA/UPnP-Server"],
    "settings.radios": ["Radiostationer", "Radio stations", "Radiostationer", "Radiostasjoner", "Radiosender"],
    "settings.radiosHelp": ["Direkte MP3- eller AAC-stream og valgfrit logo", "Direct MP3 or AAC stream and optional logo", "Direkt MP3- eller AAC-ström och valfri logotyp", "Direkte MP3- eller AAC-strøm og valgfri logo", "Direkter MP3- oder AAC-Stream und optionales Logo"],
    "settings.save": ["Gem indstillinger", "Save settings", "Spara inställningar", "Lagre innstillinger", "Einstellungen speichern"],
    "settings.saved": ["Indstillingerne er gemt", "Settings saved", "Inställningarna har sparats", "Innstillingene er lagret", "Einstellungen gespeichert"],
    "settings.serverNamePlaceholder": ["Navn, fx Medieserver", "Name, e.g. Media server", "Namn, t.ex. Medieserver", "Navn, f.eks. Medieserver", "Name, z. B. Medienserver"],
    "settings.removeServer": ["Fjern medieserver", "Remove media server", "Ta bort medieserver", "Fjern medieserver", "Medienserver entfernen"],
    "spotify.connect": ["Forbind Spotify", "Connect Spotify", "Anslut Spotify", "Koble til Spotify", "Spotify verbinden"],
    "spotify.nameUpper": ["SPOTIFY", "SPOTIFY", "SPOTIFY", "SPOTIFY", "SPOTIFY"],
    "spotify.disconnect": ["Afbryd", "Disconnect", "Koppla från", "Koble fra", "Trennen"],
    "spotify.connected": ["Spotify er forbundet", "Spotify connected", "Spotify är anslutet", "Spotify er tilkoblet", "Spotify verbunden"],
    "spotify.error.CLIENT_ID_REQUIRED": ["Tilføj Spotify Client ID i Indstillinger", "Add a Spotify Client ID in Settings", "Lägg till Spotify Client ID under Inställningar", "Legg til Spotify Client ID under Innstillinger", "Spotify Client ID unter Einstellungen hinzufügen"],
    "spotify.error.ACCESS_DENIED": ["Spotify-login blev afvist", "Spotify sign-in was denied", "Spotify-inloggningen avvisades", "Spotify-innloggingen ble avvist", "Spotify-Anmeldung wurde abgelehnt"],
    "spotify.error.INVALID_STATE": ["Ugyldigt eller udløbet Spotify-login", "Invalid or expired Spotify sign-in", "Ogiltig eller utgången Spotify-inloggning", "Ugyldig eller utløpt Spotify-innlogging", "Ungültige oder abgelaufene Spotify-Anmeldung"],
    "spotify.error.TOKEN_EXCHANGE_FAILED": ["Spotify-login kunne ikke gennemføres", "Spotify sign-in could not be completed", "Spotify-inloggningen kunde inte slutföras", "Spotify-innloggingen kunne ikke fullføres", "Spotify-Anmeldung konnte nicht abgeschlossen werden"],
    "spotify.disconnected": ["Spotify-forbindelsen er fjernet", "Spotify disconnected", "Spotify har kopplats från", "Spotify er koblet fra", "Spotify-Verbindung getrennt"],
    "spotify.notConfigured": ["Tilføj din Spotify Client ID under Indstillinger for at komme i gang.", "Add your Spotify Client ID in Settings to get started.", "Lägg till ditt Spotify Client ID under Inställningar för att komma igång.", "Legg til Spotify Client ID under Innstillinger for å komme i gang.", "Füge deine Spotify Client ID unter Einstellungen hinzu, um zu beginnen."],
    "spotify.redirect": ["Brug redirect URI: {uri}", "Use redirect URI: {uri}", "Använd redirect URI: {uri}", "Bruk redirect URI: {uri}", "Redirect URI verwenden: {uri}"],
    "spotify.notConnected": ["Spotify er konfigureret, men kontoen er ikke forbundet.", "Spotify is configured, but the account is not connected.", "Spotify är konfigurerat, men kontot är inte anslutet.", "Spotify er konfigurert, men kontoen er ikke tilkoblet.", "Spotify ist konfiguriert, das Konto aber nicht verbunden."],
    "spotify.connectPrompt": ["Forbind din Spotify Premium-konto for at søge og afspille.", "Connect your Spotify Premium account to search and play.", "Anslut ditt Spotify Premium-konto för att söka och spela.", "Koble til Spotify Premium-kontoen for å søke og spille.", "Verbinde dein Spotify-Premium-Konto zum Suchen und Abspielen."],
    "spotify.connectedAs": ["Forbundet som {name}", "Connected as {name}", "Ansluten som {name}", "Tilkoblet som {name}", "Verbunden als {name}"],
    "spotify.searchPrompt": ["Søg efter numre, albums, artister eller playlister.", "Search for tracks, albums, artists, or playlists.", "Sök efter låtar, album, artister eller spellistor.", "Søk etter spor, album, artister eller spillelister.", "Nach Titeln, Alben, Künstlern oder Playlists suchen."],
    "spotify.loadFailed": ["Spotify kunne ikke indlæses.", "Spotify could not be loaded.", "Spotify kunde inte läsas in.", "Spotify kunne ikke lastes.", "Spotify konnte nicht geladen werden."],
    "spotify.active": ["aktiv", "active", "aktiv", "aktiv", "aktiv"],
    "spotify.noDevices": ["Ingen Connect-enheder", "No Connect devices", "Inga Connect-enheter", "Ingen Connect-enheter", "Keine Connect-Geräte"],
    "spotify.devicesFailed": ["Kunne ikke hente enheder", "Could not load devices", "Kunde inte hämta enheter", "Kunne ikke hente enheter", "Geräte konnten nicht geladen werden"],
    "spotify.onSpotify": ["{title} på Spotify", "{title} on Spotify", "{title} på Spotify", "{title} på Spotify", "{title} auf Spotify"],
    "spotify.searching": ["Søger på Spotify efter “{query}”...", "Searching Spotify for “{query}”...", "Söker på Spotify efter ”{query}”...", "Søker på Spotify etter «{query}»...", "Spotify wird nach „{query}“ durchsucht..."],
    "spotify.results": ["{count} resultater fra Spotify", "{count} results from Spotify", "{count} resultat från Spotify", "{count} resultater fra Spotify", "{count} Ergebnisse von Spotify"],
    "spotify.loadingAlbum": ["Henter album fra Spotify...", "Loading album from Spotify...", "Hämtar album från Spotify...", "Henter album fra Spotify...", "Album wird von Spotify geladen..."],
    "spotify.albumSummary": ["{album} · {artist} · {count} numre", "{album} · {artist} · {count} tracks", "{album} · {artist} · {count} låtar", "{album} · {artist} · {count} spor", "{album} · {artist} · {count} Titel"],
    "spotify.type.track": ["Nummer", "Track", "Låt", "Spor", "Titel"],
    "spotify.type.album": ["Album", "Album", "Album", "Album", "Album"],
    "spotify.type.artist": ["Artist", "Artist", "Artist", "Artist", "Künstler"],
    "spotify.type.playlist": ["Playlist", "Playlist", "Spellista", "Spilleliste", "Playlist"],
    "spotify.helpButton": ["Vis vejledning til Spotify Client ID", "Show Spotify Client ID guide", "Visa guide för Spotify Client ID", "Vis veiledning for Spotify Client ID", "Anleitung zur Spotify Client ID anzeigen"],
    "spotify.helpEyebrow": ["SPOTIFY OPSÆTNING", "SPOTIFY SETUP", "SPOTIFY-KONFIGURATION", "SPOTIFY-OPPSETT", "SPOTIFY-EINRICHTUNG"],
    "spotify.helpTitle": ["Sådan får du et Client ID", "How to get a Client ID", "Så får du ett Client ID", "Slik får du en Client ID", "So erhältst du eine Client ID"],
    "spotify.closeHelp": ["Luk vejledning", "Close guide", "Stäng guiden", "Lukk veiledningen", "Anleitung schließen"],
    "spotify.help1Title": ["Åbn Spotify Dashboard", "Open Spotify Dashboard", "Öppna Spotify Dashboard", "Åpne Spotify Dashboard", "Spotify Dashboard öffnen"],
    "spotify.help1Text": ["Gå til developer.spotify.com/dashboard, og log ind med den Spotify-konto, du vil bruge.", "Go to developer.spotify.com/dashboard and sign in with the Spotify account you want to use.", "Gå till developer.spotify.com/dashboard och logga in med det Spotify-konto du vill använda.", "Gå til developer.spotify.com/dashboard og logg inn med Spotify-kontoen du vil bruke.", "Öffne developer.spotify.com/dashboard und melde dich mit dem gewünschten Spotify-Konto an."],
    "spotify.help1Before": ["Gå til", "Go to", "Gå till", "Gå til", "Öffne"],
    "spotify.help1After": [", og log ind med den Spotify-konto, du vil bruge.", "and sign in with the Spotify account you want to use.", "och logga in med det Spotify-konto du vill använda.", "og logg inn med Spotify-kontoen du vil bruke.", "und melde dich mit dem gewünschten Spotify-Konto an."],
    "spotify.help2Title": ["Opret en app", "Create an app", "Skapa en app", "Opprett en app", "App erstellen"],
    "spotify.help2Text": ["Klik på Create app. Giv appen et valgfrit navn, for eksempel iEast Controller, og skriv en kort beskrivelse.", "Click Create app. Give it any name, such as iEast Controller, and add a short description.", "Klicka på Create app. Ge appen ett valfritt namn, till exempel iEast Controller, och skriv en kort beskrivning.", "Klikk på Create app. Gi appen et valgfritt navn, for eksempel iEast Controller, og skriv en kort beskrivelse.", "Klicke auf Create app. Gib der App einen Namen, etwa iEast Controller, und eine kurze Beschreibung."],
    "spotify.help3Title": ["Tilføj Redirect URI", "Add Redirect URI", "Lägg till Redirect URI", "Legg til Redirect URI", "Redirect URI hinzufügen"],
    "spotify.help3Text": ["Indsæt adressen herunder præcist som vist. Den følger den adresse, du bruger til at åbne controlleren.", "Enter the address below exactly as shown. It follows the address you use to open the controller.", "Ange adressen nedan exakt som den visas. Den följer adressen du använder för att öppna kontrollen.", "Skriv inn adressen nedenfor nøyaktig som vist. Den følger adressen du bruker til å åpne kontrolleren.", "Trage die Adresse unten genau wie gezeigt ein. Sie entspricht der Adresse, über die du den Controller öffnest."],
    "spotify.help4Title": ["Vælg Web API", "Select Web API", "Välj Web API", "Velg Web API", "Web API auswählen"],
    "spotify.help4Text": ["Markér Web API under de API'er eller SDK'er, appen skal bruge, acceptér Spotifys vilkår, og opret appen.", "Select Web API under the APIs or SDKs the app will use, accept Spotify's terms, and create the app.", "Markera Web API under de API:er eller SDK:er som appen ska använda, godkänn Spotifys villkor och skapa appen.", "Merk av Web API under API-ene eller SDK-ene appen skal bruke, godta Spotifys vilkår og opprett appen.", "Wähle Web API bei den APIs oder SDKs der App, akzeptiere Spotifys Bedingungen und erstelle die App."],
    "spotify.help5Title": ["Kopiér Client ID", "Copy Client ID", "Kopiera Client ID", "Kopier Client ID", "Client ID kopieren"],
    "spotify.help5Text": ["Åbn appens Settings eller Basic Information, kopiér værdien ved Client ID, og indsæt den i feltet bag denne vejledning. Du skal ikke bruge Client Secret.", "Open the app's Settings or Basic Information, copy the Client ID, and paste it into the field behind this guide. You do not need the Client Secret.", "Öppna appens Settings eller Basic Information, kopiera Client ID och klistra in det i fältet bakom guiden. Du behöver inte Client Secret.", "Åpne appens Settings eller Basic Information, kopier Client ID og lim den inn i feltet bak veiledningen. Du trenger ikke Client Secret.", "Öffne Settings oder Basic Information der App, kopiere die Client ID und füge sie in das Feld hinter dieser Anleitung ein. Das Client Secret wird nicht benötigt."],
    "spotify.help6Title": ["Gem og forbind", "Save and connect", "Spara och anslut", "Lagre og koble til", "Speichern und verbinden"],
    "spotify.help6Text": ["Klik på Gem indstillinger. Gå derefter til Spotify i controlleren, og klik på Forbind Spotify.", "Click Save settings. Then go to Spotify in the controller and click Connect Spotify.", "Klicka på Spara inställningar. Gå sedan till Spotify i kontrollen och klicka på Anslut Spotify.", "Klikk på Lagre innstillinger. Gå deretter til Spotify i kontrolleren og klikk Koble til Spotify.", "Klicke auf Einstellungen speichern. Öffne dann Spotify im Controller und klicke auf Spotify verbinden."],
    "spotify.understood": ["Forstået", "Got it", "Jag förstår", "Forstått", "Verstanden"],
    "spotify.redirectHttps": ["Spotify kræver HTTPS for offentlige domæner og adresser på lokalnetværket. Brug HTTPS eller konfigurér SPOTIFY_REDIRECT_URI til din offentlige HTTPS-adresse.", "Spotify requires HTTPS for public domains and local-network addresses. Use HTTPS or set SPOTIFY_REDIRECT_URI to your public HTTPS address.", "Spotify kräver HTTPS för offentliga domäner och lokala nätverksadresser. Använd HTTPS eller ställ in SPOTIFY_REDIRECT_URI till din offentliga HTTPS-adress.", "Spotify krever HTTPS for offentlige domener og lokalnettadresser. Bruk HTTPS eller sett SPOTIFY_REDIRECT_URI til den offentlige HTTPS-adressen.", "Spotify benötigt HTTPS für öffentliche Domains und Adressen im lokalen Netzwerk. Verwende HTTPS oder setze SPOTIFY_REDIRECT_URI auf deine öffentliche HTTPS-Adresse."],
    "spotify.redirectLoopback": ["Ved lokal brug kræver Spotify en loopback-IP som 127.0.0.1 frem for localhost.", "For local use, Spotify requires a loopback IP such as 127.0.0.1 instead of localhost.", "För lokal användning kräver Spotify en loopback-IP som 127.0.0.1 i stället för localhost.", "For lokal bruk krever Spotify en loopback-IP som 127.0.0.1 i stedet for localhost.", "Für die lokale Nutzung verlangt Spotify eine Loopback-IP wie 127.0.0.1 statt localhost."],
    "spotify.redirectDashboard": ["Sørg for, at denne HTTPS-adresse også står i Spotify Dashboard.", "Make sure this HTTPS address is also listed in Spotify Dashboard.", "Se till att HTTPS-adressen också finns i Spotify Dashboard.", "Sørg for at HTTPS-adressen også står i Spotify Dashboard.", "Stelle sicher, dass diese HTTPS-Adresse auch im Spotify Dashboard eingetragen ist."],
    "spotify.viewAlbum": ["Vis album", "View album", "Visa album", "Vis album", "Album anzeigen"],
    "error.actionFailed": ["Handlingen mislykkedes", "The action failed", "Åtgärden misslyckades", "Handlingen mislyktes", "Aktion fehlgeschlagen"]
  };

  const codes = ["INVALID_CONFIG", "INVALID_DEVICE_IP", "TOO_MANY_ENTRIES", "MEDIA_SERVER_NAME_REQUIRED", "RADIO_NAME_REQUIRED", "SPOTIFY_NOT_CONNECTED", "MEDIA_SERVER_NOT_FOUND", "SEARCH_QUERY_INVALID", "SPOTIFY_ALBUM_INVALID", "SPOTIFY_CONTENT_INVALID", "SPOTIFY_DEVICE_UNAVAILABLE", "TONE_UNSUPPORTED", "TONE_INVALID", "SELECTION_REQUIRED", "SELECTION_NOT_PLAYABLE", "QUEUE_ITEM_INVALID", "PLAYLIST_NAME_REQUIRED", "PLAYLIST_EMPTY", "PLAYLIST_NOT_PLAYABLE", "PLAYLIST_NOT_FOUND", "METADATA_INVALID", "FOLDER_INVALID", "MEDIA_SERVER_REQUIRED", "ALBUM_INVALID", "COMMAND_INVALID", "URL_INVALID", "NOT_FOUND"];
  const errorTexts = {
    da: ["Ugyldig konfiguration", "Indtast en gyldig iEast IP-adresse", "For mange poster", "Alle medieservere skal have et navn", "Alle radiolinks skal have et navn", "Spotify er ikke forbundet", "Medieserveren findes ikke længere", "Søg med mindst 2 tegn", "Ugyldigt Spotify-album", "Ugyldigt Spotify-indhold", "iEast er ikke synlig i Spotify Connect. Åbn Spotify-appen og vælg enheden én gang.", "Den valgte iEast-enhed kan ikke aflæse tonekontrol", "Ugyldig toneindstilling", "Vælg mindst ét nummer eller album", "Valget indeholder ingen afspillelige numre", "Ugyldigt nummer i køen", "Afspilningslisten skal have et navn", "Afspilningslisten er tom", "Afspilningslisten indeholder ingen afspillelige numre", "Afspilningslisten findes ikke", "Ugyldige metadata", "Ugyldig mappe", "Tilføj først en medieserver i indstillinger", "Ugyldigt album", "Ugyldig kommando", "Indtast en gyldig http- eller https-URL", "Ikke fundet"],
    en: ["Invalid configuration", "Enter a valid iEast IP address", "Too many entries", "All media servers must have a name", "All radio links must have a name", "Spotify is not connected", "The media server no longer exists", "Search using at least 2 characters", "Invalid Spotify album", "Invalid Spotify content", "iEast is not visible in Spotify Connect. Open the Spotify app and select the device once.", "The selected iEast device does not support tone controls", "Invalid tone setting", "Select at least one track or album", "The selection contains no playable tracks", "Invalid queue item", "The playlist must have a name", "The playlist is empty", "The playlist contains no playable tracks", "The playlist does not exist", "Invalid metadata", "Invalid folder", "Add a media server in Settings first", "Invalid album", "Invalid command", "Enter a valid HTTP or HTTPS URL", "Not found"],
    sv: ["Ogiltig konfiguration", "Ange en giltig iEast IP-adress", "För många poster", "Alla medieservrar måste ha ett namn", "Alla radiolänkar måste ha ett namn", "Spotify är inte anslutet", "Medieservern finns inte längre", "Sök med minst 2 tecken", "Ogiltigt Spotify-album", "Ogiltigt Spotify-innehåll", "iEast syns inte i Spotify Connect. Öppna Spotify-appen och välj enheten en gång.", "Den valda iEast-enheten stöder inte tonkontroller", "Ogiltig toninställning", "Välj minst en låt eller ett album", "Valet innehåller inga spelbara låtar", "Ogiltig låt i kön", "Spellistan måste ha ett namn", "Spellistan är tom", "Spellistan innehåller inga spelbara låtar", "Spellistan finns inte", "Ogiltiga metadata", "Ogiltig mapp", "Lägg först till en medieserver i Inställningar", "Ogiltigt album", "Ogiltigt kommando", "Ange en giltig HTTP- eller HTTPS-URL", "Hittades inte"],
    nb: ["Ugyldig konfigurasjon", "Skriv inn en gyldig iEast IP-adresse", "For mange oppføringer", "Alle medieservere må ha et navn", "Alle radiolenker må ha et navn", "Spotify er ikke tilkoblet", "Medieserveren finnes ikke lenger", "Søk med minst 2 tegn", "Ugyldig Spotify-album", "Ugyldig Spotify-innhold", "iEast er ikke synlig i Spotify Connect. Åpne Spotify-appen og velg enheten én gang.", "Den valgte iEast-enheten støtter ikke tonekontroller", "Ugyldig toneinnstilling", "Velg minst ett spor eller album", "Valget inneholder ingen avspillbare spor", "Ugyldig spor i køen", "Spillelisten må ha et navn", "Spillelisten er tom", "Spillelisten inneholder ingen avspillbare spor", "Spillelisten finnes ikke", "Ugyldige metadata", "Ugyldig mappe", "Legg først til en medieserver i Innstillinger", "Ugyldig album", "Ugyldig kommando", "Skriv inn en gyldig HTTP- eller HTTPS-URL", "Ikke funnet"],
    de: ["Ungültige Konfiguration", "Gib eine gültige iEast-IP-Adresse ein", "Zu viele Einträge", "Alle Medienserver benötigen einen Namen", "Alle Radiolinks benötigen einen Namen", "Spotify ist nicht verbunden", "Der Medienserver existiert nicht mehr", "Suche mit mindestens 2 Zeichen", "Ungültiges Spotify-Album", "Ungültiger Spotify-Inhalt", "iEast ist in Spotify Connect nicht sichtbar. Öffne die Spotify-App und wähle das Gerät einmal aus.", "Das ausgewählte iEast-Gerät unterstützt keine Klangregelung", "Ungültige Klangeinstellung", "Wähle mindestens einen Titel oder ein Album", "Die Auswahl enthält keine abspielbaren Titel", "Ungültiger Titel in der Warteschlange", "Die Wiedergabeliste benötigt einen Namen", "Die Wiedergabeliste ist leer", "Die Wiedergabeliste enthält keine abspielbaren Titel", "Die Wiedergabeliste existiert nicht", "Ungültige Metadaten", "Ungültiger Ordner", "Füge zuerst unter Einstellungen einen Medienserver hinzu", "Ungültiges Album", "Ungültiger Befehl", "Gib eine gültige HTTP- oder HTTPS-URL ein", "Nicht gefunden"]
  };
  const localeOrder = Object.keys(localeNames);
  const catalogs = Object.fromEntries(localeOrder.map((locale, localeIndex) => [locale,
    Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[localeIndex]]))
  ]));
  codes.forEach((code, index) => localeOrder.forEach((locale) => {
    catalogs[locale][`error.${code}`] = errorTexts[locale][index];
  }));
  const legacyErrors = Object.fromEntries(errorTexts.da.flatMap((text, index) => [
    [text, `error.${codes[index]}`],
    ...(text === "Tilføj først en medieserver i indstillinger" ? [["Tilføj en medieserver i indstillinger", `error.${codes[index]}`]] : [])
  ]));
  Object.assign(legacyErrors, {
    "Ugyldig medieserver-adresse": "error.URL_INVALID",
    "Request body is too large": "error.REQUEST_TOO_LARGE"
  });
  localeOrder.forEach((currentLocale, index) => {
    catalogs[currentLocale]["error.REQUEST_TOO_LARGE"] = ["Forespørgslen er for stor", "The request is too large", "Begäran är för stor", "Forespørselen er for stor", "Die Anfrage ist zu groß"][index];
    catalogs[currentLocale]["error.INVALID_LANGUAGE"] = ["Ikke-understøttet sprog", "Unsupported language", "Språket stöds inte", "Språket støttes ikke", "Nicht unterstützte Sprache"][index];
    catalogs[currentLocale]["error.CONNECTION_UNAVAILABLE"] = ["Kan ikke få kontakt til den valgte enhed eller server", "Cannot reach the selected device or server", "Det går inte att nå den valda enheten eller servern", "Kan ikke kontakte den valgte enheten eller serveren", "Das ausgewählte Gerät oder der Server ist nicht erreichbar"][index];
    catalogs[currentLocale]["error.ACTION_FAILED"] = rows["error.actionFailed"][index];
  });
  const spotifyLegacyErrors = {
    "Tilfoej Spotify Client ID i Indstillinger": "CLIENT_ID_REQUIRED",
    "Ugyldig eller udloebet Spotify-login": "INVALID_STATE",
    access_denied: "ACCESS_DENIED"
  };

  let locale = "da";
  function normalize(value) {
    const tag = String(value || "").trim().toLowerCase().replace(/_/g, "-");
    if (tag === "no" || tag.startsWith("no-") || tag === "nb" || tag.startsWith("nb-")) return "nb";
    const base = tag.split("-")[0];
    return localeNames[base] ? base : "da";
  }
  function t(key, params = {}) {
    let value = catalogs[locale][key] ?? catalogs.da[key] ?? key;
    if (params.count != null) {
      const category = new Intl.PluralRules(locale).select(Number(params.count));
      value = catalogs[locale][`${key}_${category}`] ?? catalogs.da[`${key}_${category}`] ?? value;
    }
    return String(value).replace(/\{(\w+)\}/g, (match, name) => params[name] == null ? match : String(params[name]));
  }
  function setLocale(value) {
    locale = normalize(value);
    document.documentElement.lang = locale;
    document.documentElement.style.setProperty("--i18n-toggle-off", JSON.stringify(t("toggle.off")));
    document.documentElement.style.setProperty("--i18n-toggle-on", JSON.stringify(t("toggle.on")));
    document.documentElement.style.setProperty("--i18n-selection-add", JSON.stringify(t("selection.add")));
    document.documentElement.style.setProperty("--i18n-selection-added", JSON.stringify(t("selection.added")));
    document.documentElement.style.setProperty("--i18n-playlist-empty", JSON.stringify(t("playlists.emptyPrompt")));
    document.documentElement.style.setProperty("--i18n-status", JSON.stringify(t("connection.status")));
    return locale;
  }
  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
    root.querySelectorAll("[data-i18n-attr]").forEach((element) => {
      element.dataset.i18nAttr.split(",").forEach((entry) => {
        const [attribute, key] = entry.split(":").map((part) => part.trim());
        if (attribute && key) element.setAttribute(attribute, t(key));
      });
    });
    document.title = t("app.title");
  }
  function error(data) {
    if (data?.errorCode) {
      const key = `error.${data.errorCode}`;
      const translated = t(key, data.errorParams || {});
      if (translated !== key) return translated;
    }
    if (legacyErrors[data?.error]) return t(legacyErrors[data.error], data.errorParams || {});
    return data?.error || t("error.actionFailed");
  }
  function spotifyError(code, fallback) {
    const normalizedCode = String(code || spotifyLegacyErrors[fallback] || "").toUpperCase().replace(/-/g, "_");
    const key = `spotify.error.${normalizedCode}`;
    return normalizedCode && t(key) !== key ? t(key) : fallback || "";
  }

  window.I18n = { t, apply, error, spotifyError, setLocale, normalize, localeNames, get locale() { return locale; } };
  setLocale("da");
})();
