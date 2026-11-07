# BMW iDrive 7 apps

Apps for the BMW MGU head unit (iDrive 7), built on the MGU App Kit from
[cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps)
(MIT; the renderer and emulator draw engine are GPL-3.0-or-later, see `kit/renderd`).

The kit was imported at upstream commit `6a269e7` without its reference apps. Its full guide is
[KIT_README.md](KIT_README.md); the live emulator is described in [docs/emulator.md](docs/emulator.md).

| Path | What |
|---|---|
| `apps/<id>/` | our apps: `app.json` + `main.js` |
| `kit/` | the MGU App Kit: runtime, build tools, renderer, emulator |
| `deploy/` | scripts that put the apps on the car |

```sh
python3 kit/tools/build.py --preview-only <id>   # without BMW's oap-sdk (offline preview)
node kit/tools/emu.js <id>                        # live emulator on http://localhost:8077
```

Building an installable package needs `oap-sdk`, extracted from your own head unit
(`kit/tools/extract_sdk.js`); it is never committed.
