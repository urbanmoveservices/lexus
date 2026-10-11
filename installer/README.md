# Windows release build

Run `python installer/build-windows.py` after supplying the existing Electron/Node runtime and the official Chrome for Testing win64 runtime under `releases/build-cache/chrome/chrome-win64`. The native .NET Framework C# compiler included with Windows builds the launcher and setup EXE.

The installer includes app dependencies, Electron, Node and Chrome for WEB-2/APP/HEADLESS. WEB-3 requires Brave to be installed separately. Installation is per-user in `%LOCALAPPDATA%\Programs\LEXUS`; profile and activation data is stored in `%LOCALAPPDATA%\LEXUS\data` and preserved when updating or uninstalling. Close the installed app before updating. The updater ZIP omits runtime/browser folders and must be extracted over an existing installation.

`lexus-config.json` is generated in the package and points to `https://lexus.vaidya-gpt.com`. Private local data and admin credentials are excluded. This build is not code-signed.

Publish the versioned EXE, updater ZIP and manifest.json to `/srv/lexus-releases`. The hosted service mounts this directory read-only. The installer supports `/extract <path-under-Windows-temp>` for package validation without registering an installation.
