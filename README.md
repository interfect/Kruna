# Kruna

## Cloud Music User Agent

Kruna is an alternative client for cloud music services, providing a user interface reminiscent of the now-defunct [Grooveshark](https://en.wikipedia.org/wiki/Grooveshark). Kruna aims to place control of the cloud music listening experience firmly in the hands of listeners.

## Installation

1. Clone this repository

2. Make sure that you have a version of `node` installed which builds binary modules compatible with `node 5.10`.

3. Run `npm install` in your repository.

4. Run `npm start` to start up the app.

## Usage

After the application starts up, you should have a browser-like window, with Chromium developer tools on the right. Ignore the developer tools, and log in with your Spotify account.

Once you log in, the player proper will start up. A few "available songs" that I have selected will show up in the top part of the window. You can click on the items in the song list in order to append them to your playlist at the bottom. You can also run a search to get access to other songs in the Spotify catalog.

To play a song in the playlist, click on it (or press the play button).

The check and heart buttons on the songs don't work yet, and songs currently can't be re-ordered by dragging. (Song re-ordering is one of the main reasons this project was started, so that should be coming soon.)

## How it Works

Kruna is a [node.js](https://nodejs.org) application, running inside [Electron](https://github.com/electron/electron).

The application uses [node-spotify-web](https://github.com/sciencepro/node-spotify-web) to connect to Spotify over the same channels as [the Spotify Web Player](https://play.spotify.com/). This is the key piece of the application, and motivated the selection of node.js as an implementation language. Currently, the linked fork above, rather than @TooTallNate's version, is being used, because the "official" node-spotify-web has not been patched to keep up with Spotify's API changes. Since the library is using an internal Spotify API, such breakage is likely to recur in the future.

MP3 decoding is done in JavaScript using [Aurora.js](https://github.com/audiocogs/aurora.js). The UI state is primarily managed by [Ractive.js](https://github.com/ractivejs/ractive).

## Caveats

This application uses internal Spotify APIs, so it may break at any time if Spotify decides to change them. Additionally, it uses Spotify in a way it was not intended to be used, and which Spotify may or may not approve of. **Using this application may have negative consequences for your Spotify account, at the sole discression of Spotify Inc.!** Spotify Inc. has nothing to do with this application, and the developers of this application do not own the "Spotify" trademark.

In other words, **use at your own risk!**
