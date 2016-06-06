"use strict"

// Load up Electron
const electron = require('electron')
const ipc = require('electron').ipcMain
const dialog = require('electron').dialog
const AV = require('av');
const mp3 = require('mp3');

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
        
        // Tell the UI we're ready
        event.sender.send('login-successful')
        
    })
})

// Play a track from a Spotify URL like spotify:track:6tdp8sdXrXlPV6AZZN2PE8
// Calls the finish_callback when done.
function playTrack(spotify_url, finish_callback) {
    
    console.log('Loading: %s with %s', spotify_url, spotify_session)
    
    spotify_session.get(spotify_url, function (err, track) {
        if (err) throw err
        
        console.log('Playing: %s - %s', track.artist[0].name, track.name)
       
        // play() returns a readable stream of MP3 audio data
        var play_stream = track.play()
        
        // We need an AV BufferLIst to play from
        var buffer_list = new AV.BufferList()
        
        var big_buffer = new Buffer(0)
        
        // Have we started the player yet?
        var started = false;
        
        play_stream.on('data', (chunk) => {
            if(chunk !== null) {
                console.log('got %d bytes of data', chunk.length)
                // For each data chunk buffer we get, stick it in a BufferList.
                buffer_list.append(chunk)
                
                big_buffer = Buffer.concat([big_buffer, chunk]);
                
                if(!started) {
                    // Start the player now that we don't have absolutely no data
                    started = true

                    play_stream.on('end', () => {
                        
                        // Make a player from this buffer list
                        var player = AV.Player.fromBuffer(big_buffer)
                        
                        player.on('error', (err) => {
                            console.log('Player Error: ' + err)
                            throw err
                        })
                        
                        player.once('ready', () => {
                            // When the file is ready to play, play
                            console.log('player is ready')
                            player.play()
                        })
                        
                        player.on('end', () => {
                            // We're done!
                            console.log('player is done')
                            finish_callback()
                        })
                        
                        // Wait for data, eventually emit 'ready'
                        player.preload()
                    })
                }
            }
        })

        

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
