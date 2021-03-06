// We define a player module using the Module Pattern
// See <http://www.adequatelygood.com/JavaScript-Module-Pattern-In-Depth.html>
var Player = (function() {

    // This will get exported and hold all the public stuff as the global Player
    var player = {
        // This holds the Ractive object for the main player
        ractive: null,
        // This holds the initial ractive data
        data: {
            brandName: "Kruna",
            // This is the One True Play State, as an index into the playlist array. It gets watched by the code that
            // makes sound come out of the speakers, and set to play different songs.
            playingIndex: 0,
            // This holds the playback status. This is where we should be in a song.
            playback: {
                // Are we playing or paused?
                state: "paused",
                // Song length in ms
                duration: 0,
                // Time elapsed in ms
                progress: 0
            },
            // This is a list of song records to play
            playlist: [],
            // These are the songs we can play
            availableSongs: [],
            // This is the next noince value for songs added to the playlist
            nextNonce: 0,
            // This is the search query we're sending
            searchQuery: ""
        },
        
        // This is the event channel through which we communicate with the code
        // doing the actual song playing. We .send() evens at it, and listen for
        // returning events with .on().
        ipc: null
    };
    
    /**
     * Load the specified URL (which ought to be a Ractive template) and return
     * a promise for its string contents.
     */
    player.getTemplate = function(url) {
        // TODO: intern templates in our own cache?
        return new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url);
            xhr.overrideMimeType("text/plain");
            xhr.onload = function() {
                // This function gets the XHR as this, and fires when the XHR is
                // done, one way or the other.
                
                console.log("Got " + url + " with " + xhr.statusText);
                
                // Grab the status
                var status = this.status;
                if(status >= 200 && status < 300) {
                    // Status code is in the success range
                    resolve(xhr.responseText);
                } else {
                    // Something else happened (server returned error)
                    // We're upposed to reject with Error objects
                    reject(Error("XHR refused: " + xhr.statusText));
                }
            };
            xhr.onerror = function() {
                // Something happened and the request errored out
                reject(Error("XHR error: " + xhr.statusText));
            };
            
            // Kick off the request.
            console.log("Getting " + url);
            xhr.send();
        });
    }
    
    /**
     * Return a unique ID (to distinguish instances of the same song in the
     * playlist, when the playlist entries are shifted around.
     */
    player.nonce = function() {
        var nonce = player.ractive.get("nextNonce");
        player.ractive.set("nextNonce", nonce + 1);
        return nonce;
    }
    
    /**
     * Skip to the next song.
     */
    player.skipAhead = function() {
        // Play the next song
        var index = player.ractive.get("playingIndex");
        var playlist = player.ractive.get("playlist");
        
        
        if(index >= playlist.length) {
            // Already off the end
            return;
        }
        
        // Otherwise we're still in the playlist. Go to the right.
        index += 1;
        player.ractive.set("playingIndex", index);
        
        if(index >= playlist.length) {
            // If we go off the end, stop playback.
            player.ractive.set("playback.state", "paused");
        } else {
            // Otherwise, start playback
            player.ractive.set("playback.state", "playing");
        }
    }
    
    /**
     * Skip to the previous song.
     */
    player.skipBack = function() {
        // Play the previous song
        var index = player.ractive.get("playingIndex");
        var playlist = player.ractive.get("playlist");
        
        
        if(index == 0) {
            // Already at the first track
            return;
        }
        
        // Otherwise we're still not at the start. Go to the left.
        index -= 1;
        player.ractive.set("playingIndex", index);
        
        // Startr playback of this track (which should exist)
        player.ractive.set("playback.state", "playing");
    }
    
    /**
     * Download and parse some JSON, and return a promise.
     * TODO: Make this and the template getting function both be one basic XHR function.
     */
    player.getJSON = function(url) {
        return new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url);
            xhr.overrideMimeType("text/json");
            xhr.onload = function() {
                // This function gets the XHR as this, and fires when the XHR is
                // done, one way or the other.
                
                console.log("Got " + url + " with " + xhr.statusText);
                
                // Grab the status
                var status = this.status;
                if(status >= 200 && status < 300) {
                    // Status code is in the success range
                    var parsed;
                    try {
                        // Parse the JSON
                        parsed = JSON.parse(xhr.responseText);
                    } catch(err) {
                        // We can't parse this JSON
                        reject(err);
                    }
                    
                    // OK we parsed it!
                    resolve(parsed);
                } else {
                    // Something else happened (server returned error)
                    // We're upposed to reject with Error objects
                    reject(Error("XHR refused: " + xhr.statusText));
                }
            };
            xhr.onerror = function() {
                // Something happened and the request errored out
                reject(Error("XHR error: " + xhr.statusText));
            };
            
            // Kick off the request.
            console.log("Getting " + url);
            xhr.send();
        });
    }
    
    /**
     * Download songs from the given URL and keep them in the local database.
     */
    player.loadSongs = function(url) {
        player.getJSON(url).then(function(songs) {
            // Add all the songs we downloaded.
            player.ractive.merge("availableSongs", songs);
        }).catch(err => console.log(err));
    };
    
    /**
     * Make a new Player on the page, in the given DOM element.
     */
    player.start = function(element, ipc) {
        // Save the IPC
        player.ipc = ipc;
    
        // Get the template text
        player.getTemplate("templates/player.html")
            .then(function(templateText) {
                // Make the Ractive
                player.ractive = new Ractive({
                    el: element,
                    template: templateText,
                    data: player.data,
                    computed: {
                        // Compute the currently playing song from the playingIndex index and the playlist.
                        // It can't be updated directly, but it updates when they do.
                        nowPlaying: function() {
                            var index = this.get("playingIndex");
                            var playlist = this.get("playlist");
                            if(index !== null && index >= 0 && index < playlist.length) {
                                // This song is playing
                                return playlist[index];
                            } else {
                                // No song is playing
                                return null;
                            }
                        }
                    }
                });
                
                // Assign events
                player.ractive.on("play", function(event, index) {
                    // Play event happened
                    
                    if(index !== undefined && index < this.get("playlist").length) {
                        console.log("Starting song " + index + "...");
                        this.set("playingIndex", index);
                    }
                    
                    if(this.get("playingIndex") >= this.get("playlist").length) {
                        // Can't play an out-of-bounds song
                        console.log("Starting first song...");
                        this.set("playingIndex", 0)
                    }
                    
                    this.set("playback.state", "playing");
                });
                
                player.ractive.on("pause", function(event) {
                    // Pause event happened
                    this.set("playback.state", "paused");
                });
                
                player.ractive.on("skipAhead", function(event) {
                    // Skip ahead event happened
                    player.skipAhead();
                });
                
                player.ractive.on("skipBack", function(event) {
                    // Skip back event happened
                    player.skipBack();
                });
                
                player.ractive.on("queue", function(event, index) {
                    // Play event happened
                    var song = this.get("availableSongs[" + index + "]");
                    // Put the song on the playlist in a playlist entry
                    this.push("playlist", {song: song, nonce: player.nonce()});
                });
                
                player.ractive.on("remove", function(event, index) {
                    // Playlist remove event happened
                    
                    // What are we playing now? May be what we're removing.
                    var currentIndex = this.get("playingIndex");
                    
                    if(index < currentIndex) {
                        // We need to remove something from now or in the past,
                        // which necessitates a big atomic update.
                        
                        // Deep copy the playlist
                        var newPlaylist = this.get("playlist").slice(0);
                        
                        // Drop the song
                        newPlaylist.splice(index, 1);
                        
                        // Make the update
                        this.set({
                            playlist: newPlaylist,
                            playingIndex: currentIndex - 1
                        });
                    } else {
                        // The thing we are removing is in the future and can be
                        // removed simply. If it's what we're on, we'll go off
                        // the end or on to the next song.
                        this.splice("playlist", index, 1);
                    }
                    
                    // Don't play the song we're removing.
                    return false;
                    
                });
                
                player.ractive.on("save", function(event, index) {
                    // Add the song to the user's saved songs
                    console.log("Saving song " + index + "...");
                    
                    // TODO: implement
                    
                    return false;
                });
                
                player.ractive.on("love", function(event, index) {
                    // Add the song to the user's favorite (and saved) songs
                    console.log("Loving song " + index + "...");
                    
                    // TODO: implement
                    
                    return false;
                });
                
                player.ractive.on("scrollPlaylist", function(event) {
                    // Handle scrollwheel in playlist to make it scroll horizontally
                    document.querySelector(".playlist").scrollLeft += event.original.deltaY;                    
                });
                
                // Watch the nowPlaying state and make actual sound
                player.ractive.observe("nowPlaying", function(val) {
                    console.log("Now playing: ", val);
                    if(val == null) {
                        // Pause if there's nothing to play.
                        this.set("playback.state", "paused");
                    }
                });
                
                player.ractive.observe("playlist", function(val) {
                    if(val.length === undefined) {
                        // Skip out on bogus playlists
                        return;
                    }
                    
                    if(this.get("playingIndex") > val.length) {
                        // When things get removed from the playlist, and we're
                        // off the end, we need to walk back to the past-the-end
                        // index for the shorter playlist.
                        this.set("playingIndex", val.length);
                    }
                });
                
                player.ractive.observe("playback.state", function(val) {
                    if(val == "playing" && this.get("nowPlaying") == null) {
                        // We can't play a song that's not present.
                        this.set("playback.state", "paused");
                    } else if(val == "paused") {
                        player.ipc.send('player-pause');
                    } else {
                        player.ipc.send('player-play');
                    }
                });
                
                
                player.ractive.observe("nowPlaying.nonce", function(newValue, oldValue, keypath) {
                    // We watch the nonce because different playlist entries for
                    // the same song should be distinct and need to fire the
                    // observer.
                    
                    // What's the new URL?
                    var newUrl = undefined;
                    if(newValue !== undefined && newValue !== null) {
                        newUrl = this.get("nowPlaying.song.url");
                    }

                    // Pause any currently playing song
                    player.ipc.send('player-pause');
                    
                    if(newUrl !== undefined && newUrl != "") {
                        // Start playing the new song
                        console.log("Make new player");

                        // We don;t want to start immediately unless we think we're playing.
                        var playNow = (player.ractive.get("playback.state") == "playing");
                        
                        // Say to start playing this URL
                        player.ipc.send('player-url', newUrl, playNow);
                    }
                });
                
                // We also need to updat the ractive when we get messages from
                // the music player itself.
                
                // Handle song duration in ms
                player.ipc.on("player-duration", function(event, duration) {
                    
                    if(isNaN(duration)) {
                        // Ignore NaN duration
                        return;
                    }
                    
                    player.ractive.set("playback.duration", duration);
                });
                
                // Handle song progress in ms
                player.ipc.on("player-progress", function(event, progress) {
                    
                    if(isNaN(progress)) {
                        // Ignore NaN progress
                        return;
                    }
                    
                    player.ractive.set("playback.progress", progress);
                });
                
                // And one for when the song ends
                player.ipc.on("player-ended", function(event) {
                    // Go to the next song.
                    player.skipAhead();
                });
                
                // And now the stuff we need for search
                player.ractive.on("search", function(event) {
                    // When someone hits search, send a search event
                    player.ipc.send("player-search", player.ractive.get("searchQuery"));
                });
                
                // And for when we get a page of songs to show
                player.ipc.on("player-songs", function(event, songs) {
                    // Just override all the songs we have already
                    console.log(songs);
                    player.ractive.set("availableSongs", songs);
                })
                
                // Start looking for songs.
                player.loadSongs("songs.json");
                
            })
            // Or complain about an error
            .catch(err => console.log(err));
    };
    
    // Export the module object
    return player;
}());
