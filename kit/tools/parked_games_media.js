'use strict';
/**
 * parked_games_media.js - the README's screenshots and animated GIFs of Parked Games, made
 * offline: the built app runs on the stubbed head unit (hu-stub.js, as preview.js), every frame
 * is drawn by the kit's software renderer, and a simple autopilot plays each game.
 *
 *   python3 kit/tools/build.py --preview-only parked_games
 *   node kit/tools/parked_games_media.js [outDir] [game ...]     (default docs/media/parked-games)
 *
 * The clock is virtual (process.hrtime), so every frame is exactly 1000 / FPS ms of game time
 * however long it takes to draw. The car is faked as parked; the autopilots stand in for the knob.
 * Needs ffmpeg for the GIFs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const STAGE = path.join(ROOT, 'dist', 'parked_games');
const GAMES = path.join(STAGE, 'source', 'javascript', 'games');
const args = process.argv.slice(2);
const OUT = path.resolve(args[0] && !/^[a-z]+-[a-z]+$/.test(args[0]) ? args.shift() : path.join(ROOT, 'docs', 'media', 'parked-games'));
const ONLY = args;
const FPS = 15, DT = 1000 / FPS, GIF_W = 720, MONTAGE_S = 5;

if (!fs.existsSync(GAMES)) { console.error('build first: python3 kit/tools/build.py --preview-only parked_games'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

/* ---------- a virtual clock: the shell and the games read process.hrtime ---------- */
let vt = 1000;
const realHr = process.hrtime;
process.hrtime = function (prev) {
    const s = Math.floor(vt / 1000), ns = Math.round((vt - s * 1000) * 1e6);
    if (!prev) return [s, ns];
    let ds = s - prev[0], dn = ns - prev[1];
    if (dn < 0) { ds--; dn += 1e9; }
    return [ds, dn];
};
process.hrtime.bigint = realHr.bigint;

/* ---------- the car: parked (or moving, for the menu-moving shot) ---------- */
const { Vehicle } = require(path.join(STAGE, 'source', 'javascript', 'vehicle'));
let moving = false;
Vehicle.prototype.state = () => ({ moving });

/* ---------- autopilots: wrap each game's create() so a bot works its knob every frame ---------- */
let live = null;          // { id, game, api, bot } of the round on screen
const bots = {
    'lane-runner': (gm) => {
        const r = gm.run;
        return {
            tick() {
                if (live.crash) { r.lane = 4; return; }           // sit in the bottom lane and take whatever comes
                const ahead = r.things.filter((o) => o.kind !== 'can' && o.x > 150).sort((a, b) => a.x - b.x)[0];
                if (!ahead) return;
                const row = r.things.filter((o) => o.kind !== 'can' && Math.abs(o.x - ahead.x) < 80), blocked = new Set();
                row.forEach((o) => { for (let k = 0; k < o.lanes; k++) blocked.add(o.lane + k); });
                if (blocked.has(r.lane)) {
                    const to = [0, 1, 2, 3, 4].filter((l) => !blocked.has(l)).sort((a, b) => Math.abs(a - r.lane) - Math.abs(b - r.lane))[0];
                    gm.input({ type: 'knob', delta: to > r.lane ? 1 : -1 });      // one click a frame, like a hand on the knob
                }
            },
        };
    },
    'canyon-glide': (gm) => {
        const { pilot } = require(path.join(GAMES, 'canyon-glide', 'autopilot'));
        const frame = gm.frame.bind(gm);
        gm.frame = () => Object.assign(frame(), { steer: live.crash ? 0.7 : -pilot(gm.round) });
        return {};
    },
    'rev-keeper': (gm) => {
        let pc = null;
        return {
            tick() {
                const g = gm.g;
                if (live.crash) { gm.throttle = 1; return; }
                const v = pc === null ? 0 : (g.zone.c - pc) * FPS, j = g.pendingJump && g.pendingJump();
                pc = g.zone.c;
                const want = j && j.t > j.warn - 0.1 ? j.to : g.zone.c + v * 0.1;
                gm.throttle = Math.round(Math.max(0, Math.min(1, want)) * 25) / 25;    // knob clicks of 4 %
            },
        };
    },
    'paddle-duel': (gm) => {
        // the car against the car: both paddles on the CPU
        const assign = gm.assign.bind(gm);
        gm.assign = function () {
            assign();
            ['L', 'R'].forEach((s) => { if (this.g[s].ctl !== 'cpu') this.g.setControl(s, 'cpu'); });
            this.g.o.left = 'cpu'; this.g.o.right = 'cpu';
            this.g.names = { L: 'YOU  ·  KNOB', R: 'CAR' };
            this.g.hint = null;
        };
        gm.assign();
        return {};
    },
    'brick-breaker': (gm) => ({
        tick() {
            const g = gm.g;
            if (g.state === 'serve' || g.banner > 0) { if (!live.crash) g.action(); }
            const b = g.balls.filter((x) => !x.stuck).sort((a, c) => a.x - c.x)[0];
            if (g.hits !== gm._hits || gm._off == null) { gm._hits = g.hits; gm._off = (Math.random() - 0.5) * 70; }
            if (b && !live.crash) g.aim(b.y + gm._off);
            if (live.crash) g.aim(0);
        },
    }),
    'block-drop': () => {
        let wait = 0, plan = null;
        return {
            tick(eng) {
                if (!eng || eng.over() || eng.phase !== 'fall') return;
                if ((wait -= DT) > 0) return;
                wait = 90;
                const p = eng.piece;
                if (!plan || plan.p !== p) {
                    // the lowest column (the first of the lowest), the piece upright
                    const h = [];
                    for (let c = 0; c < eng.cols; c++) { let r = 0; while (r < eng.rows && eng.board[r][c] < 0) r++; h.push(r); }
                    let col = 0;
                    h.forEach((r, c) => { if (r > h[col] + (Math.random() < 0.3 ? 1 : 0)) col = c; });
                    plan = { p, col: live.crash ? p.col : col };
                }
                // (a wall can stop it short of the column: then it drops where it is)
                if (p.col === plan.col || !eng.move(p.col < plan.col ? 1 : -1)) { eng.drop(); plan = null; wait = 260; }
            },
        };
    },
};
// Block Drop keeps its engine in a closure: catch it as it is made
let blockEng = null;
{
    const engine = require(path.join(GAMES, 'block-drop', 'engine'));
    const Orig = engine.BlockDrop;
    engine.BlockDrop = class extends Orig { constructor(o) { super(o); blockEng = this; } };
}
for (const id of Object.keys(bots)) {
    const mod = require(path.join(GAMES, id, 'index'));
    const create = mod.create.bind(mod);
    mod.create = (api) => {
        const a = Object.assign({}, api);
        const gm = create(a);
        const bot = bots[id](gm);
        a.end = (score) => { live.ended = true; return api.end(score); };
        live = { id, gm, bot, crash: false, ended: false };
        return gm;
    };
}

/* ---------- the head unit ---------- */
const { headUnit } = require('./hu-stub');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-media-'));
let last = null;
const hu = headUnit(STAGE, { dataDir: data, fresh: true, image: async (name, cv) => { last = cv; } });
hu.ui.isVisible = (n) => n === 'MAIN';
hu.start();

async function frame() {
    if (live && live.bot.tick) live.bot.tick(blockEng);
    vt += DT;
    await hu.loopFn();
    return last;
}
const rgba = (cv) => Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length);
function png(cv, name) { fs.writeFileSync(path.join(OUT, name), cv.png()); console.log('  ' + name); }
const PALETTE = (w, colours) => `scale=${w}:-1:flags=lanczos,split[x][y];[x]palettegen=stats_mode=diff:max_colors=${colours}[p];[y][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
const ff = (a) => execFileSync('ffmpeg', ['-v', 'error', '-y'].concat(a));
const kib = (f) => (fs.statSync(f).size >> 10) + ' KiB';
/** n frames: kept as a near-lossless video (for the montage) and written as <name>.gif */
async function clip(name, n, each) {
    const tmp = path.join(data, name + '.rgba'), fd = fs.openSync(tmp, 'w');
    let cv = null;
    for (let i = 0; i < n; i++) { cv = await frame(); if (each) each(i); fs.writeSync(fd, rgba(cv)); }
    fs.closeSync(fd);
    const mp4 = path.join(data, name + '.mp4'), gif = path.join(OUT, name + '.gif');
    ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', cv.w + 'x' + cv.h, '-r', String(FPS), '-i', tmp, '-c:v', 'libx264rgb', '-crf', '4', mp4]);
    fs.unlinkSync(tmp);
    ff(['-i', mp4, '-filter_complex', PALETTE(GIF_W, 160), gif]);
    console.log('  ' + name + '.gif  ' + kib(gif));
    return mp4;
}
/** the six games playing at once, 2 x 3 */
function montage(clips) {
    const gif = path.join(OUT, 'all-games.gif'), w = 480, h = 156;
    const ins = [].concat.apply([], clips.map((c) => ['-i', c]));
    const scaled = clips.map((c, i) => `[${i}:v]trim=duration=${MONTAGE_S},setpts=PTS-STARTPTS,scale=${w}:${h}:flags=lanczos,pad=${w + 8}:${h + 8}:4:4:color=0x05070d[v${i}]`).join(';');
    const stack = clips.map((c, i) => `[v${i}]`).join('') + `xstack=inputs=${clips.length}:layout=0_0|w0_0|0_h0|w0_h0|0_h0+h2|w0_h0+h2`;
    ff(ins.concat(['-filter_complex', `${scaled};${stack},fps=12,split[x][y];[x]palettegen=stats_mode=diff:max_colors=160[p];[y][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, gif]));
    console.log('  all-games.gif  ' + kib(gif));
}
const sec = (s) => Math.round(s * FPS);
const targets = () => hu.display.pageTargets || [];
async function openGame(id) {
    for (let i = 0; i < 3; i++) await frame();
    const t = targets().find((q) => q.key === id);
    if (!t) throw new Error('no menu tile for ' + id + ' (' + targets().map((q) => q.key).join(', ') + ')');
    await t.run();
}
async function toMenu() { await hu.display.onTab(0); }

const PLAN = {
    // id: [seconds skipped (countdown), seconds of GIF, seconds to the result card at most]
    'lane-runner': [2.2, 7, 25],
    'paddle-duel': [1, 7, 0],
    'canyon-glide': [1.5, 7, 0],
    'rev-keeper': [3.4, 7, 0],
    'brick-breaker': [1, 7, 0],
    'block-drop': [0.5, 9, 0],
};

(async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const clips = [];
    const want = (id) => !ONLY.length || ONLY.indexOf(id) >= 0;
    if (want('menu')) {
        console.log('menu');
        for (let i = 0; i < sec(1.5); i++) await frame();
        png(last, 'menu.png');
    }
    for (const id of Object.keys(PLAN)) {
        if (!want(id)) continue;
        console.log(id);
        const [skip, len, toEnd] = PLAN[id];
        await openGame(id);
        for (let i = 0; i < sec(skip); i++) await frame();
        clips.push(await clip(id, sec(len)));
        if (toEnd) {
            live.crash = true;
            for (let i = 0; i < sec(toEnd) && !live.ended; i++) await frame();
            for (let i = 0; i < sec(1.6); i++) await frame();      // the result card slides in
            png(last, id + '-result.png');
        }
        live = null; blockEng = null;
        await toMenu();
    }
    if (clips.length === 6) montage(clips);
    if (want('menu')) {
        // the car drives off: the menu says why nothing opens
        moving = true;
        for (let i = 0; i < sec(1.5); i++) await frame();
        png(last, 'menu-moving.png');
    }
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
