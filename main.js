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

// Load up configuration
const nconf = require('nconf').file({file: getUserHome() + '/kruna-settings.json'})
nconf.load()

var Speaker = require('speaker');
var Readable = require('stream').Readable;

if(Speaker === null) {
    throw new Error("Can't make Speaker")
}

var device = AV.AudioDevice.create(44100, 2)

if(device === null) {
    throw new Error("Can't make AudioDevice")
}

// Load up Spotify
const Spotify = require('spotify-web')

// Keep a global spotify session around
var spotify_session = null

// Module to control application life.
const app = electron.app
// Module to create native browser window.
const BrowserWindow = electron.BrowserWindow

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

function createWindow () {
    // Create the browser window.
    mainWindow = new BrowserWindow({width: 800, height: 600})

    // and load the index.html of the app.
    mainWindow.loadURL(`file://${__dirname}/index.html`)

    // Open the DevTools.
    //mainWindow.webContents.openDevTools()

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
   this.play_stream = null;
   
   // Define a min size for the first buffer, because Aurora cries if it's too
   // small to guess the filetype.
   this.min_buffer_size = 16384 * 100000000;
   
   // And keep a buffer to put stuff in
   this.buffer = new Buffer(0);
   
   console.log('SpotifySource: created')
};

SpotifySource.prototype.start = function() {
    console.log('SpotifySource: starting')

    if(this.play_stream !== null) {
        // We must be paused
        return this.play_stream.resume()
    }
    
    // Otherwise start up the play stream
    this.play_stream = this.track.play()
    
    // Forward data events
    // TODO: maybe make chunks bigger
    this.play_stream.on('data', (chunk) => {
        //console.log('SpotifySource: %d bytes in chunk', chunk.length)
        
        // Concatenate new data with any data we had been holding
        this.buffer = Buffer.concat([this.buffer, chunk])
        
        if(this.buffer.length >= this.min_buffer_size) {
            // Spit out this data and empty our internal buffer
            console.log('SpotifySource: emitting %d bytes', this.buffer.length)
            
            // We need to convert from Node buffers to Aurora buffers
            this.emit('data', new AV.Buffer(this.buffer))
            this.buffer = new Buffer(0);
        } else {
            //console.log('SpotifySource: only have %d bytes. Waiting...', this.buffer.length)
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
        if(this.buffer.length > 0) {
            console.log('SpotifySource: emitting %d final bytes', this.buffer.length)
            
            // Dump to disk
            fs.writeFile("test.mp3", this.buffer, () => {
                // We need to convert from Node buffers to Aurora buffers
                this.emit('data', new AV.Buffer(this.buffer))
                this.buffer = new Buffer(0);
            }); 
            
        }
        this.emit('progress', 100)
        this.emit('end')
    })
    
    // TODO: compute progress
}

SpotifySource.prototype.pause = function() {
    console.log('SpotifySource: pausing')
    if(this.play_stream !== null) {
        // We have somthing to pause
        this.play_stream.pause()
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
        this.buffer = new Buffer(0);
    }
}

// Make SpotifySource an EventEmitter
util.inherits(SpotifySource, EventEmitter);

// Play a track from a Spotify URL like spotify:track:6tdp8sdXrXlPV6AZZN2PE8
// Calls the finish_callback when done.
function playTrack(spotify_url, finish_callback) {
    
    console.log('Loading: %s with %s', spotify_url, spotify_session)
    
    spotify_session.get(spotify_url, function (err, track) {
        if (err) throw err
        
        console.log('Playing: %s - %s', track.artist[0].name, track.name)
       
        // Make a source
        var spotify_source = new SpotifySource(track)
        
        // Make an Asset of the source
        var asset = new AV.Asset(spotify_source)
       
        // Make a player from the asset
        var player = new AV.Player(asset)
                    
        player.on('error', (err) => {
            console.log('Player Error: ' + err)
            throw err
        })
        
        player.on('progress', (msecs) => {
            console.log('Progress: %d', msecs)
        })
        
        player.on('end', () => {
            // We're done!
            console.log('player is done')
            finish_callback()
        })
        
        // Ready never fires. Just play.
        player.play()
                  
    });
}

ipc.on('play-track', (event, url) => {
    // Play the given Spotify track.
    // TODO: stop existing ones
    playTrack(url, () => {
        // Send the event to the renderer thread which will ask for another track.
        event.sender.send('track-done')
    })
})
