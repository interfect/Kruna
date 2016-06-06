"use strict"
// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

const ipc = require('electron').ipcRenderer

// Set up login
var loginButton = document.querySelector('#login')
loginButton.addEventListener('click', function () {
    ipc.send('spotify-login', document.querySelector('#username').value, document.querySelector('#password').value)
});

ipc.on('login-successful', function() {
    // We successfully logged in to Spotify.
    // Hide the login form
    document.querySelector('.login').style.display = 'none'
    // Display the actual player
    document.querySelector('.player').style.display = 'block'
})

var playButton = document.querySelector('#playtrack')
playButton.addEventListener('click', function () {
    ipc.send('play-track', document.querySelector('#track').value)
});
