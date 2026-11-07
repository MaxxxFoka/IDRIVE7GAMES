'use strict';
/**
 * Parked Games - small games for when the car is parked, all in one app.
 *
 * The shell (this file) owns everything around a game; the games plug in as games/<id>/index.js
 * (the interface: GAMES.md). One canvas screen, MAIN (the kit's display drives one canvas screen
 * with the GPU renderer, touch and the controller), in two modes:
 *   menu  a tile per game (title, line, best score, WHEEL / PEDAL tags), tapped or chosen with the
 *         knob (the kit's page targets), and what the wheel and pedal can do right now.
 *   game  the round, the whole page. The header's tabs: GAMES (back to the menu, the round paused),
 *         the game's own, and the kit's SETTINGS. BACK leaves the app (the round pauses; it goes on
 *         when the app is opened again).
 *
 * Safety: the app plays only while the car stands (setting "Parked only", on by default). The
 * steering wheel counts only in P with the parking brake applied; the accelerator pedal also needs
 * the engine off (vehicle.js). Otherwise, and wherever the signals don't come, the knob stands in.
 */
const path = require('path');
const mgu = require('./kit/mgu');
const Parked = require('./kit/parked');
const G = require('./kit/gauges');
const { Vehicle } = require('./vehicle');
const { Controller } = require('./controls');
const { load, Scores, Store } = require('./registry');

const W = 1600, H = 520;
const SLOTS = 10;                                     // games on the menu (two rows of tiles)
const KNOB_STEER_DEG = 6, KNOB_PEDAL_PCT = 5, STEER_LIMIT = 180;

const mono = () => { const h = process.hrtime(); return h[0] * 1000 + h[1] / 1e6; };
const has = (g, x) => (g.needs || []).indexOf(x) >= 0;
const fmt = (g, n) => {
    if (n === null || n === undefined) return '-';
    if (g.score && typeof g.score.format === 'function') { try { return String(g.score.format(n)); } catch (e) { /* fall through */ } }
    const s = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return g.score && g.score.unit ? s + ' ' + g.score.unit : s;
};

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const games = load(path.join(__dirname, 'games'), log);
        log.info('games: ' + (games.map((g) => g.id).join(', ') || 'none'));
        const scores = new Scores(path.join(ctx.dataDir, 'scores.json'));
        const store = new Store(path.join(ctx.dataDir, 'game-data.json'));

        /* ---------- the car ---------- */
        const parked = Parked.watch(ctx, log);
        const car = new Vehicle();
        const reversed = () => settings.get('steerDir') === 'reversed';
        const watch = (iface, handlers) => ctx.signals.watch(iface, '1', handlers, log, { pollMs: 2000 })
            .then((s) => log.info(iface.split('.').pop() + ': ' + (s.error ? 'error: ' + s.error : 'subscribed')))
            .catch((e) => log.warn(iface + ': ' + e));
        watch('de.bmw.infotainment.vehicle.Vehicle2', { statusCarSpeed2: (v) => car.speedRaw(v) });
        watch('de.bmw.infotainment.vehicle.CDS', {
            statusHandBrake: (v) => car.handbrakeRaw(v),
            statusEngineSpeed2: (v) => car.rpmRaw(v),
            statusEngineStatus: (v) => car.engineStatusRaw(v),
        });
        watch('de.bmw.infrastructure.VehicleInformation', {
            statusGearboxDrive: (v) => car.gearboxRaw(v),
            DataPowerTrain2: (v) => car.selectionRaw(v),
        });
        watch('de.bmw.chassis.SteeringAngle', {
            ActualSteeringAngleDriver: (v) => car.steerRaw(v, reversed()),
            actualSteeringAngleDriverNoCRC: (v) => car.steerRaw(v, reversed()),
        });
        watch('de.bmw.powertrain.AcceleratorPedal', { AngleAcceleratorPedal: (v) => car.pedalRaw(v) });
        const state = () => {
            const st = car.state({ parkedOnly: settings.get('parkedOnly'), wheel: settings.get('wheel') });
            // the kit's own parked check reads the same speed (and re-reads it every 2 s)
            if (settings.get('parkedOnly') !== false && parked.moving()) st.moving = true;
            return st;
        };

        /* ---------- a round ---------- */
        let cur = null;          // { g, game, phase: 'play' | 'paused' | 'over', score, place, steer, pedal, err }
        const ctl = new Controller();
        function api(g, round) {
            const st = () => state();
            return {
                W, H, log: {
                    info: (...a) => log.info.apply(null, [g.id + ':'].concat(a)),
                    warn: (...a) => log.warn.apply(null, [g.id + ':'].concat(a)),
                    error: (...a) => log.error.apply(null, [g.id + ':'].concat(a)),
                },
                now: mono, random: Math.random, theme: ctx.theme,
                best: () => scores.best(g.id), top: () => scores.top(g.id),
                store: store.forGame(g.id),
                end(score) {
                    if (cur !== round || round.phase === 'over') return;
                    round.phase = 'over'; round.score = score;
                    round.prevBest = scores.best(g.id);
                    round.place = scores.add(g, score);
                    log.info(g.id + ': round over, ' + fmt(g, score) + (round.place === 1 ? ' (new best)' : ''));
                },
                steering() {
                    const s = st();
                    if (s.wheel) return car.steerDeg;
                    return has(g, 'wheel') ? round.steer : null;
                },
                steerSource() { const s = st(); return s.wheel ? 'wheel' : has(g, 'wheel') ? 'knob' : null; },
                pedal() {
                    const s = st();
                    if (s.pedal) return car.pedalPct;
                    if (!has(g, 'pedal')) return null;
                    return has(g, 'wheel') ? (ctl.held('N') ? 100 : 0) : round.pedal;
                },
                pedalSource() { const s = st(); return s.pedal ? 'pedal' : has(g, 'pedal') ? 'knob' : null; },
            };
        }
        function newRound(g) {
            const round = { g, game: null, phase: 'play', score: null, place: 0, steer: 0, pedal: 0, err: null };
            cur = round;
            try { round.game = g.create(api(g, round)); } catch (e) { fail(round, e); }
            if (!round.game) fail(round, new Error('create() returned nothing'));
            lastT = mono();
            log.info(g.id + ': new round');
        }
        function fail(round, e) {
            log.error(round.g.id + ' stopped', e);
            round.err = e; round.phase = 'over'; round.game = null;
        }
        const call = (fn) => {
            const r = cur;
            if (!r || !r.game) return;
            try { fn(r.game); } catch (e) { fail(r, e); }
        };
        function pause() {
            if (!cur || cur.phase !== 'play') return;
            cur.phase = 'paused';
            call((gm) => gm.pause && gm.pause());
        }
        function resume() {
            if (!cur || cur.phase !== 'paused' || state().moving) return;
            cur.phase = 'play'; lastT = mono();
            call((gm) => gm.resume && gm.resume());
        }
        /** The main action (knob press, tap, the bar button): continue, or play again. */
        function action() {
            if (!cur) return false;
            if (cur.phase === 'paused') { resume(); return true; }
            if (cur.phase === 'over') { newRound(cur.g); return true; }
            return false;
        }

        /* ---------- input ---------- */
        function input(ev) {
            if (!cur || mode !== 'game' || !shown()) return;
            if (cur.phase !== 'play') {
                if (ev.type === 'press' || ev.type === 'tap') action();
                return;
            }
            const g = cur.g;
            if (ev.type === 'knob') {
                if (has(g, 'wheel')) cur.steer = Math.max(-STEER_LIMIT, Math.min(STEER_LIMIT, cur.steer + ev.delta * KNOB_STEER_DEG));
                else if (has(g, 'pedal')) cur.pedal = Math.max(0, Math.min(100, cur.pedal + ev.delta * KNOB_PEDAL_PCT));
            } else if (ev.type === 'press' && has(g, 'wheel')) cur.steer = 0;
            call((gm) => gm.input && gm.input(ev));
        }
        // the controller: while the game holds it the renderer hands on what the HMI didn't get; the
        // app's own FrontCCU copy is the fallback (as in the kit's Doom)
        let ccuT = 0;
        const feed = (v) => ctl.feed(v).forEach(input);
        if (ctx.controller && ctx.controller.onInput) ctx.controller.onInput((v) => { ccuT = Date.now(); feed(v); });
        watch('de.bmw.infotainment.controlelements.FrontCCU', { statusRotaryEncoderState: (v) => { if (Date.now() - ccuT > 1000) feed(v); } });
        const PH = { 1: 'down', 2: 'move', 3: 'up' };
        if (ctx.onTouch) ctx.onTouch((phase, x, y) => { if (PH[phase]) input({ type: 'touch', phase: PH[phase], x, y }); });
        ctx.onTap((x, y) => input({ type: 'tap', x, y }));

        /* ---------- the menu: a tile per game (the kit's page targets: tap, or turn and press) ---------- */
        let sel = 0, mode = 'menu';
        function open(g) {
            if (state().moving) return;
            sel = games.indexOf(g);
            if (!(cur && cur.g === g && cur.phase !== 'over')) newRound(g);
            mode = 'game'; lastT = mono();
        }
        function toMenu() { pause(); mode = 'menu'; }
        // the header's tabs: 0 = GAMES (the menu), 1 = the round's game
        ctx.onTab((i) => { if (i === 0) toMenu(); else if (i === 1 && cur && !state().moving) { mode = 'game'; lastT = mono(); } });
        const tabs = () => ['Games'].concat(cur ? [cur.g.title] : []);
        function status(st) {
            if (st.moving) return 'Parked only: the games wait while the car moves';
            const w = st.wheel ? 'Steering wheel ready' : 'Wheel: ' + st.why.wheel + ', the knob steers';
            const p = st.pedal ? 'pedal ready' : 'pedal: ' + st.why.pedal;
            return w + '  ·  ' + p;
        }
        const TAG = { wheel: 'WHEEL', pedal: 'PEDAL' };
        function drawMenu() {
            const t = ctx.theme(), st = state();
            const cv = ctx.canvas(W, H).clear(t.bg);
            G.frame(cv, t, tabs(), 0);
            const top = G.TOP + 12, bottom = G.pageBottom(cv) - 8;
            cv.text(status(st), 24, top + 22, 22, st.moving ? (t.warn || t.text) : t.dim, { font: 'label' });
            if (!games.length) { cv.text('No games installed', W / 2, (top + bottom) / 2, 32, t.dim, { align: 'center', font: 'bold' }); return ui.image('MAIN_GFX', cv); }
            const n = Math.min(games.length, SLOTS), cols = n <= 8 ? 4 : 5, rows = Math.ceil(n / cols);
            const gx = 24, gy = top + 40, gap = 16;
            const tw = (W - 2 * gx - gap * (cols - 1)) / cols, th = Math.min(200, (bottom - gy - gap * (rows - 1)) / rows);
            games.slice(0, SLOTS).forEach((g, i) => {
                const x = gx + (i % cols) * (tw + gap), y = gy + Math.floor(i / cols) * (th + gap);
                const going = cur && cur.g === g && cur.phase === 'paused';
                cv.roundRect(x, y, tw, th, 14, t.panel || '#1a1d22');
                if (i === sel) cv.strokeRoundRect(x, y, tw, th, 14, 2, t.dim);
                cv.clip(x, y, tw - 8, th);
                cv.text(g.title, x + 20, y + 44, 30, st.moving ? t.dim : t.text, { font: 'bold' });
                if (g.blurb) cv.text(g.blurb, x + 20, y + 76, 20, t.dim, { font: 'label' });
                cv.noclip();
                const b = scores.best(g.id);
                cv.text(b === null ? 'no score yet' : 'best ' + fmt(g, b), x + 20, y + th - 22, 22, b === null ? t.dim : t.accent, { font: 'bold' });
                const tags = (g.needs || []).map((k) => TAG[k]).filter(Boolean).concat(going ? ['PAUSED'] : []);
                let tx = x + tw - 16;
                tags.reverse().forEach((s) => {
                    const w = cv.textWidth(s, 15, { font: 'bold' }) + 18;
                    tx -= w;
                    cv.roundRect(tx, y + 16, w, 26, 8, s === 'PAUSED' ? t.accent : [255, 255, 255, 28]);
                    cv.text(s, tx + w / 2, y + 35, 15, s === 'PAUSED' ? t.bg : t.dim, { font: 'bold', align: 'center' });
                    tx -= 8;
                });
                cv.target(x, y, tw, th, () => open(g), g.id, 14);
            });
            return ui.image('MAIN_GFX', cv);
        }
        if (games.length > SLOTS) log.warn('only the first ' + SLOTS + ' games fit the menu');

        /* ---------- run while the game is on screen ---------- */
        const shown = () => ui.isVisible('MAIN') && !ui.isVisible('SETTINGS') && (!ui.hasFocus || ui.hasFocus('MAIN'));
        let grabbed = false;
        function sync() {
            const st = state();
            if (st.moving && cur && cur.phase === 'play') { pause(); log.info('car moving: paused'); }
            if (st.moving && mode === 'game') mode = 'menu';
            if (!shown()) pause();
            const want = shown() && mode === 'game' && !st.moving;
            if (want !== grabbed) { grabbed = want; if (ctx.controller) ctx.controller.grab(want); }
        }
        setInterval(sync, 200);
        if (ui.onFocus) ui.onFocus(() => sync());

        /* ---------- drawing ---------- */
        let lastT = mono();
        function render() {
            if (mode !== 'game' || !cur) return drawMenu();
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            G.frame(cv, t, tabs(), 1);         // the header's tabs (full-screen layout: drawn in the header, not on the page)
            const now = mono(), dt = Math.min(50, Math.max(0, now - lastT));
            lastT = now;
            if (cur.phase === 'play') call((gm) => gm.update(dt));
            call((gm) => gm.draw(cv));
            hint(cv, t);
            if (cur.phase === 'paused') paused(cv, t);
            else if (cur.phase === 'over') result(cv, t);
            return ui.image('MAIN_GFX', cv);
        }
        /** Where the wheel / pedal can't be used: one small line, bottom left. */
        function hint(cv, t) {
            const g = cur.g, st = state();
            let s = null;
            if (has(g, 'wheel') && !st.wheel) s = 'Knob steering (wheel: ' + st.why.wheel + ')';
            else if (has(g, 'pedal') && !st.pedal) s = (has(g, 'wheel') ? 'Push up for the pedal' : 'Knob pedal') + ' (pedal: ' + st.why.pedal + ')';
            if (s) cv.text(s, 16, H - 12, 18, t.dim, { font: 'label' });
        }
        function card(cv, t, w, h) {
            cv.fillRect(0, 0, W, H, [0, 0, 0, 150]);
            const x = (W - w) / 2, y = (H - h) / 2;
            cv.roundRect(x, y, w, h, 18, t.panel || '#1a1d22');
            cv.strokeRoundRect(x, y, w, h, 18, 2, t.accent);
            return { x, y };
        }
        function paused(cv, t) {
            const p = card(cv, t, 760, 200);
            cv.text('Paused', W / 2, p.y + 80, 40, t.text, { align: 'center', font: 'bold' });
            cv.text(state().moving ? 'Stop the car to play' : 'Press the controller or tap to go on.  GAMES tab: the menu', W / 2, p.y + 140, 24, t.dim, { align: 'center', font: 'label' });
        }
        function result(cv, t) {
            const g = cur.g;
            const p = card(cv, t, 820, 380);
            if (cur.err) {
                cv.text(g.title + ' stopped', W / 2, p.y + 90, 40, t.crit || t.text, { align: 'center', font: 'bold' });
                cv.text(String(cur.err.message || cur.err).slice(0, 70), W / 2, p.y + 150, 22, t.dim, { align: 'center', font: 'label' });
                cv.text('Press the controller or tap to try again', W / 2, p.y + 330, 24, t.dim, { align: 'center', font: 'label' });
                return;
            }
            const best = cur.place === 1;
            cv.text(best ? 'New best!' : 'Game over', p.x + 50, p.y + 70, 40, best ? t.accent : t.text, { font: 'bold' });
            // the big size has digits only: the number big, the unit (or a game's own format) at a size with every letter
            const big = (g.score && typeof g.score.format === 'function') ? null : fmt(Object.assign({}, g, { score: {} }), cur.score);
            if (big !== null && /^[0-9 .,:-]+$/.test(big)) {
                const bw = cv.text(big, p.x + 50, p.y + 170, 72, t.text, { font: 'num' });
                if (g.score && g.score.unit) cv.text(g.score.unit, p.x + 50 + bw + 12, p.y + 170, 32, t.dim, { font: 'bold' });
            } else cv.text(fmt(g, cur.score), p.x + 50, p.y + 165, 40, t.text, { font: 'bold' });
            if (!best && cur.prevBest !== null) cv.text('Best ' + fmt(g, cur.prevBest), p.x + 50, p.y + 220, 26, t.dim, { font: 'label' });
            // the top list, right
            const top = scores.top(g.id), lx = p.x + 470;
            cv.text('Top ' + top.length, lx, p.y + 70, 26, t.dim, { font: 'bold' });
            top.forEach((e, i) => {
                const mine = i + 1 === cur.place;
                cv.text((i + 1) + '.', lx, p.y + 115 + i * 40, 26, mine ? t.accent : t.dim, { font: 'label' });
                cv.text(fmt(g, e.score), lx + 46, p.y + 115 + i * 40, 26, mine ? t.accent : t.text, { font: 'bold' });
            });
            cv.text('Press the controller or tap to play again.  GAMES tab: the menu', W / 2, p.y + 345, 22, t.dim, { align: 'center', font: 'label' });
        }
        ctx.loop('MAIN', 30, render);
        log.info('parked games started');
    },
});
