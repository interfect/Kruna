"use strict"
// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

const ipc = require('electron').ipcRenderer

// Ask the main thread to feed us some Spotify credentials
ipc.send('load-credentials')

// Set up login
var loginButton = document.querySelector('#login')
loginButton.addEventListener('click', function () {
    ipc.send('spotify-login', document.querySelector('#username').value, document.querySelector('#password').value)
});

// Log in with saved credentials
ipc.on('stored-credentials', (event, username, password) => {
    document.querySelector('#username').value = username
    document.querySelector('#password').value = password
    ipc.send('spotify-login', document.querySelector('#username').value, document.querySelector('#password').value)
})

ipc.on('login-successful', () => {
    // We successfully logged in to Spotify.
    // Hide the login form
    document.querySelector('.login').style.display = 'none'
    // Display the actual player
    document.querySelector('.player').style.display = 'block'
    
    // Start up the ractive, with the DIV it uses and the IPC channel to the
    // actual player backend.
    Player.start(document.querySelector("#player"), ipc)
    
})
