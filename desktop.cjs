const { app, ipcMain, shell, nativeImage, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const distributionConfig = require('./distribution-config.cjs');
if (!process.env.LEXUS_LICENSE_URL) process.env.LEXUS_LICENSE_URL = distributionConfig.licenseUrl || 'https://lexus.vaidya-gpt.com';
if (distributionConfig.bundledChrome && !process.env.OCEAN_CHROME_PATH) process.env.OCEAN_CHROME_PATH = path.join(__dirname, 'browsers', 'chrome', 'chrome.exe');
const braveCandidates=[process.env.LEXUS_BRAVE_PATH,path.join(process.env.LOCALAPPDATA||'', 'BraveSoftware','Brave-Browser','Application','brave.exe'),'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe','C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'].filter(Boolean);
const installedBrave=braveCandidates.find(candidate=>fs.existsSync(candidate));
if(installedBrave)process.env.OCEAN_BRAVE_PATH=installedBrave;
process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();
process.env.LEXUS_DESKTOP_ROOT=distributionConfig.installed ? path.join(process.env.LOCALAPPDATA || app.getPath('appData'),'LEXUS','data') : path.join(__dirname,'desktop-data');
process.env.LEXUS_ACTIVATION_HOME=path.join(process.env.LEXUS_DESKTOP_ROOT,'lexus-license');
app.setPath('userData',process.env.LEXUS_DESKTOP_ROOT);
// Keep cache outside OneDrive and separate from older still-running processes.
const cacheRoot=path.join(process.env.LOCALAPPDATA||require('node:os').tmpdir(),'LEXUS','session-cache',String(process.pid));
fs.mkdirSync(cacheRoot,{recursive:true});app.setPath('sessionData',cacheRoot);app.commandLine.appendSwitch('disk-cache-dir',path.join(cacheRoot,'http-cache'));
const readyFile=path.join(__dirname,'desktop-ready.json');
if(!app.requestSingleInstanceLock()){console.log('LEXUS already running; requesting its window');app.quit();}else{
app.on('second-instance',()=>{for(const window of BrowserWindow.getAllWindows()){if(!window.isVisible()&&!window.isMinimized())continue;if(window.isMinimized())window.restore();window.show();window.focus();try{fs.writeFileSync(readyFile,JSON.stringify({pid:process.pid,time:Date.now(),title:window.getTitle()}));}catch{}}});
app.on('browser-window-created',(_event,window)=>{
 window.on('show',()=>{try{fs.writeFileSync(readyFile,JSON.stringify({pid:process.pid,time:Date.now(),title:window.getTitle()}));}catch{}});
 window.webContents.once('did-finish-load',()=>{if(!window.isDestroyed()&&window.isVisible()){window.focus();}});
 window.webContents.on('render-process-gone',(_event,details)=>console.error('LEXUS renderer exited:',details.reason));
});

ipcMain.handle('lexus:open-client',()=>shell.openExternal(process.env.LEXUS_LICENSE_URL?process.env.LEXUS_LICENSE_URL+'/client':'https://lexus.vaidya-gpt.com/client'));
app.on('browser-window-created', (_event, window) => window.setIcon(nativeImage.createFromPath(path.join(__dirname, 'app', 'assets', 'lexus-logo.jpeg'))));
require('./app/main.js');

}
