"use strict"

// Load up Electron
const electron = require('electron')
const ipc = require('electron').ipcMain
const dialog = require('electron').dialog
const AV = require('av')
const mp3 = require('mp3')
const EventEmitter = require('events').EventEmitter
const util = require('util')
const fs = require('fs')
const xml2js = require('xml2js')
const limiter = require('limiter')

// Load up configuration
const nconf = require('nconf').file({file: getUserHome() + '/kruna-settings.json'})
nconf.load()

// We have some code to check to make sure our native libraries loaded OK.
var Speaker = require('speaker');
var Readable = require('stream').Readable;

if(Speaker === null) {
    throw new Error("Can't make Speaker")
}

var device = AV.AudioDevice.create(44100, 2)

if(device === null) {
    throw new Error("Can't make AudioDevice")
}

// OK now we know our natives are working.

// Load up Spotify
const Spotify = require('spotify-web')
// And the Spotify URI utilities
const SpotifyUtil = require('spotify-web/lib/util')


// Keep a global spotify session around
var spotify_session = null

// Keep a global currently playing AV.Player. There should only be one.
var global_player = null;

// Now do Electron setup.

// Module to control application life.
const app = electron.app
// Module to create native browser window.
const BrowserWindow = electron.BrowserWindow

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

function createWindow () {
    // Create the browser window.
    mainWindow = new BrowserWindow({width: 1600, height: 600})

    // and load the index.html of the app.
    mainWindow.loadURL(`file://${__dirname}/app/index.html`)

    // Open the DevTools.
    mainWindow.webContents.openDevTools()

    // Emitted when the window is closed.
    mainWindow.on('closed', function () {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null
    })
}

// Determine where app data lives.
// Stolen from https://medium.com/developers-writing/building-a-desktop-application-with-electron-204203eeb658#.3bhbf951g
function getUserHome() {
    return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow()
    }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// Load stored credentials
ipc.on('load-credentials', (event) => {
    console.log('Loading saved credentials form settings')

    var username = nconf.get('username')
    var password = nconf.get('password')
    
    console.log('Saved user: %s', username)
    
    if(username && password) {
        event.sender.send('stored-credentials', username, password)
    }
})

// Handle a Spotify login
ipc.on('spotify-login', (event, username, password) => {
    
    // Actually log in
    Spotify.login(username, password, function (err, spotify) {
        // Make sure nothing bad happened
        if (err) throw err

        // Save the spotify session
        spotify_session = spotify
        
        console.log('Logged in %s', username)
        
        if(spotify_session === null) {
            throw "Fail!!!"
        }
        
        // Remember user and pass in config
        nconf.set('username', username)
        nconf.set('password', password)
        nconf.save()
        
        // Tell the UI we're ready
        event.sender.send('login-successful')
        
        spotify.search('the flashbulb', function (err, xml) {
            // Try a demo search
            if (err) throw err

            var parser = new xml2js.Parser()
            parser.on('end', function (data) {
                // Save the search results to disk for examination
                fs.writeFile('search.json', JSON.stringify(data, null, 2))
            })
            parser.parseString(xml)
        })
        
    })
})

// Define a SpotifySource for AV. Needs to be an EventEmitter
// Takes a Spotify track object
function SpotifySource(track) {
   // Call superclass constructor
   EventEmitter.call(this)
   // Save the track
   this.track = track
   // Keep a stream we will get buffers from
   this.play_stream = null
   
   // Define a min size for the first buffer, because Aurora cries if it's too
   // small to guess the filetype.
   this.min_buffer_size = 16384 * 20
   
   // Keep a list of buffers
   this.buffers = []
   // And track the number of bytes in them
   this.buffer_size = 0
   
   // We don't want to be running all the time, so we rate limit the passing of
   // chunks to the player. This is 1 call every 100 ms.
   this.limiter = new limiter.RateLimiter(1, 100)
   
   // This records whether a buffer flush is queued to happen when the rate
   // limiter makes it possible.
   this.flush_queued = false;
   
   console.log('SpotifySource: created')
};

SpotifySource.prototype.flush = function() {
    // Send data in the buffer to the player.
    
    // Record that no more flush is queued
    this.flush_queued = false
    
    // We want to send just one buffer to the player.
    var finalBuffer
    
    if(this.buffers.length == 0) {
        // Nothing to do!
        return
    }
    
    if(this.min_buffer_size > 0) {
        // We want to glom buffers together
        if(this.buffers.length == 1) {
            // We're going to send just the one buffer we have
            finalBuffer = new AV.Buffer(this.buffers[0])
        } else {
            // Concatenate and Aurora-ify all the buffers we have
            finalBuffer = new AV.Buffer(Buffer.concat(this.buffers))
        }
    
        console.log('SpotifySource: emitting %d bytes', finalBuffer.length)
        
        this.emit('data', finalBuffer)
        
        // Don't wait for big chunks anymore, just flush periodically.
        this.min_buffer_size = 0
    } else {
        // We emit all the buffers, but all at once
        console.log('SpotifySource: emitting %d buffers', this.buffers.length)
        for(var i = 0; i < this.buffers.length; i++) {
            // Emit each buffer as data
            this.emit('data', new AV.Buffer(this.buffers[i]))
        }
    }
    
    // Now we hold no data
    this.buffers = []
    this.buffer_size = 0
        
}

SpotifySource.prototype.start = function() {
    console.log('SpotifySource: starting')

    if(this.play_stream !== null) {
        // We must be paused
        return this.play_stream.resume()
    }
    
    // Otherwise start up the play stream
    this.play_stream = this.track.play()
    
    // Wait for a big enough first chunk
    this.min_buffer_size = 16384 * 20
    
    // Forward data events
    // TODO: maybe make chunks bigger
    this.play_stream.on('data', (chunk) => {
        // Hold on to the buffer
        this.buffers.push(chunk)
        this.buffer_size += chunk.length
        
        if(this.buffer_size > this.min_buffer_size) {
            // We have enough data that we would want to flush.
            if(!this.flush_queued) {
                // Queue up a request to flush the buffers to the player.
                this.flush_queued = true
                
                this.limiter.removeTokens(1, (err, remainingRequests) => {
                    // When it's late enough to actually flush, do it.
                    this.flush()
                })
                            
            }
        }
    })
    
    // And error events
    this.play_stream.on('error', (err) => {
        console.log('SpotifySource: error: ' + err)
        this.emit('error', err)
    })
    
    // And end events
    this.play_stream.on('end', () => {
        console.log('SpotifySource: end of stream')
        
        // Emit any remaining data
        if(!this.flush_queued) {
            // Queue up a request to flush the buffers to the player.
            this.flush_queued = true
            
            this.limiter.removeTokens(1, (err, remainingRequests) => {
                // When it's late enough to actually flush, do it.
                this.flush()
                this.emit('progress', 100)
                this.emit('end')
            })
                        
        } else {
            // A flush is already queued. After that, say we're ending the stream.
            this.limiter.removeTokens(1, (err, remainingRequests) => {
                this.emit('progress', 100)
                this.emit('end')
            })
        }
    })
    
    // TODO: compute progress
}

SpotifySource.prototype.pause = function() {
    console.log('SpotifySource: pausing')
    if(this.play_stream !== null) {
        // We have somthing to pause
        this.play_stream.pause()
        
        // TODO: can we cancel the flush callback?
    }
}

SpotifySource.prototype.reset = function() {
    console.log('SpotifySource: resetting to start')
    if(this.play_stream !== null) {
        // We have somthing to pause
        this.play_stream.pause()
        this.play_stream.close()
        // Null out the stream so start will do its work over again
        this.play_stream = null
        // And clear out the buffer so we don't stick bogus data at the front of what comes next.
        this.buffers = []
        this.buffer_size = 0
        
        // TODO: can we cancel the flush callback?
    }
}

// Make SpotifySource an EventEmitter
util.inherits(SpotifySource, EventEmitter);

ipc.on('player-url', (event, url, playNow) => {
    // Play the given Spotify track.
    
    console.log('Loading: %s with %s', url, spotify_session)
    
    spotify_session.get(url, function (err, track) {
        if (err) throw err
        
        console.log('Playing: %s - %s', track.artist[0].name, track.name)
       
        // Make a source
        var spotify_source = new SpotifySource(track)
        
        var asset = new AV.Asset(spotify_source)
        
        asset.on('format', (format) => {
            console.log('Format decoded: ' + format)
        })
        
        asset.on('duration', (duration) => {
            console.log('Duration decoded: %d', duration)
            // Inform the UI of the song duration
            event.sender.send('player-duration', duration)
        })
        
        asset.on('decodeStart', () => {
            console.log('Audio decode started')
        })
        
        // Make a new Player for the asset.
        var player = new AV.Player(asset)
        
        if(global_player !== null) {
            // If there's already a One True Player, get rid of it.
            global_player.stop();
            global_player = null;
        }
        
        // Become the One True Player
        global_player = player;
        
        player.on('error', (err) => {
            console.log('Player Error: ' + err)
            throw err
        })
        
        player.on('progress', (msecs) => {
            // Inform the UI of the playback progress
            event.sender.send('player-progress', msecs)
        })
        
        player.on('end', () => {
            // We're done!
            console.log('player is done')
            event.sender.send('player-ended')
        })
        
        // Start loading the song
        player.preload()
        
        if(playNow) {
            asset.on('duration', () => {
                // Play only if instructed, and only after duration has been
                // decoded (and we have the audio data ready to hand)
                console.log('Making play call')
                player.play()
            })
        }
        
        
    })
})

// Handle requests to pause the music
ipc.on('player-pause', (event) => {
    if(global_player !== null) {
        global_player.pause()
    }
})

// And to play it again
ipc.on('player-play', (event) => {
    if(global_player !== null) {
        global_player.play()
    }
})

// And when someone asks for songs
ipc.on('player-search', (event, query) => {
    console.log('Search: Initiating search for: %s', query)
    
    spotify_session.search(query, function (err, xml) {
        // Try a demo search
        if (err) throw err

        var parser = new xml2js.Parser()
        parser.on('end', function (data) {
            // Now we have our data. It has a "result" field with a "tracks"
            // field. In "tracks" we have an array of one object with a "track"
            // field, which holds the array of actual tracks. And each actual
            // track has 1-element arrays "id", "title", "artist", and "album",
            // which are what we need.
            
            // We convert those into songs with "title", "album", "artist", and "url".
            var songs = []
            
            if(!data.hasOwnProperty('result')) {
                // Make sure we have the "result" object
                console.log('Search: No result')
                return
            }
            
            if(!data.result.hasOwnProperty('tracks') || !Array.isArray(data.result.tracks) || data.result.tracks.length != 1) {
                // And that it has tracks
                console.log('Search: No/bad tracks')
                return
            }
            
            if(!data.result.tracks[0].hasOwnProperty('track') || !Array.isArray(data.result.tracks[0].track)) {
                // And that the actual array of track objects is there
                console.log('Search: Bad track array/No results')
                
                // If it's not, we have no results.
                event.sender.send('player-songs', [])
                
                return
            }
            
            // Pull out the actual array of tracks
            var tracks = data.result.tracks[0].track
            
            for(var i = 0; i < tracks.length; i++) {
                // Turn each track into a song
                var track = tracks[i]
                
                // Check the track
                if(!track.hasOwnProperty('title') || !track.hasOwnProperty('artist') ||
                    !track.hasOwnProperty('album') || !track.hasOwnProperty('id')) {
                    console.log('Search: Bad track #%d', i)
                    return
                }
                
                // Make the song
                var song = {
                    'title': track.title[0],
                    'artist': track.artist[0],
                    'album': track.album[0],
                    // The ID needs to be converted from hex to Base 62
                    // (alphanumeric with case). And be prepended with
                    // 'spotify:track:'.
                    'url': SpotifyUtil.id2uri('track', track.id[0])
                }
                
                // Stick it in the list
                songs.push(song)
            }
            
            // Reply with the songs
            event.sender.send('player-songs', songs)
            
        })
        parser.parseString(xml)
    })
    
})
