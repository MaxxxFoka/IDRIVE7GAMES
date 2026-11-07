'use strict';
/**
 * Parked Games: the shell's logic (vehicle.js, controls.js, registry.js) and every game in
 * apps/parked_games/games/ against the interface in apps/parked_games/GAMES.md.
 *
 *   node kit/tools/test_parked_games.js            all games
 *   node kit/tools/test_parked_games.js lane-runner one game
 *
 * Each game is played headless: created with a fake api, fed knob / press / push / touch events and
 * steering sweeps for 3 minutes of game time, drawn every frame on a canvas that checks its calls.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..', '..', 'apps', 'parked_games');
const { Vehicle } = require(path.join(APP, 'vehicle'));
const { Controller } = require(path.join(APP, 'controls'));
const { load, check, Scores, Store } = require(path.join(APP, 'registry'));

let failed = 0;
function test(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n     ')); }
}

/* ---------- vehicle.js: what the car allows ---------- */
test('vehicle: a bench with no signals is parked, the wheel and pedal stay off', () => {
    const s = new Vehicle().state();
    assert.strictEqual(s.moving, false); assert.strictEqual(s.wheel, false); assert.strictEqual(s.pedal, false);
});
test('vehicle: wheel needs standing, P and the parking brake', () => {
    const v = new Vehicle();
    v.speedRaw({ speedVehicleCentreOfGravity: 0 }); v.steerRaw({ actualValueSteeringAngleDriver: 0 });
    assert.strictEqual(v.state().why.wheel, 'needs gear P');
    v.gearboxRaw({ statusActualStageDrive: 'P' });
    assert.strictEqual(v.state().why.wheel, 'needs the parking brake');
    v.handbrakeRaw({ statusContactHandBrake: 'HANDBREMSE_ANGEZOGEN' });
    assert.strictEqual(v.state().wheel, true);
    v.speedRaw({ speedVehicleCentreOfGravity: 10 * 64 });
    const s = v.state();
    assert.strictEqual(s.moving, true); assert.strictEqual(s.wheel, false);
    assert.strictEqual(v.state({ parkedOnly: false }).moving, false);
    v.speedRaw({ speedVehicleCentreOfGravity: 0 });
    assert.strictEqual(v.state({ wheel: 'off' }).wheel, false);
});
test('vehicle: DataPowerTrain2 gives P too', () => {
    const v = new Vehicle();
    v.selectionRaw({ statusGearSelectionDrive: 3 }); assert.strictEqual(v.sel, 'P');
    v.selectionRaw({ statusGearSelectionDrive: '_4' }); assert.strictEqual(v.sel, 'D');
});
test('vehicle: pedal needs the engine off', () => {
    const v = new Vehicle();
    v.speed(0); v.stage('P'); v.handbrake(true); v.steerRaw(0); v.pedalRaw({ actualValueAngleAcceleratorPedal: 2000 });
    assert.strictEqual(v.pedalPct, 50);
    v.rpmRaw({ actualValueRPMEngineCrankshaft: 800 * 4 });
    assert.strictEqual(v.state().why.pedal, 'needs the engine off');
    v.engineStatusRaw({ statusEngineRunDrive: 'MOTOR_AUS' });
    assert.strictEqual(v.state().pedal, true);
    v.engineStatusRaw({ statusEngineRunDrive: 2 });
    assert.strictEqual(v.state().pedal, false);
});
test('vehicle: steering + = right, signed 16 bit, reversible', () => {
    const v = new Vehicle();
    v.steerRaw({ actualValueSteeringAngleDriver: 65536 - 1000 });       // raw -1000 = 43.95 deg right
    assert.ok(Math.abs(v.steerDeg - 43.95) < 0.01, v.steerDeg);
    v.steerRaw({ actualValueSteeringAngleDriver: 1000 }, true);
    assert.ok(Math.abs(v.steerDeg - 43.95) < 0.01, v.steerDeg);
});

/* ---------- controls.js ---------- */
test('controls: knob, press, push, release', () => {
    const c = new Controller();
    const st = (k, pb, df) => c.feed({ frontRotaryEncoderOperation: k, frontRotaryEncoderPushButton: pb, frontRotaryEncoderDeflection: df });
    assert.deepStrictEqual(st(10, 'KEINE_BETAETIGUNG', 'MITTELSTELLUNG'), []);
    assert.deepStrictEqual(st(12, 0, 0), [{ type: 'knob', delta: 2 }]);
    assert.deepStrictEqual(st(65535 & 0xffff, 0, 0).length, 0);           // 65535 = no counter
    assert.deepStrictEqual(st(11, 'DREHGEBER_KURZ_GEDRUECKT', 0), [{ type: 'knob', delta: -1 }, { type: 'press' }]);
    assert.deepStrictEqual(st(11, 1, 0), []);
    assert.deepStrictEqual(st(11, 0, 'NORD_KURZ_GEDRUECKT'), [{ type: 'push', dir: 'N' }]);
    assert.ok(c.held('N'));
    assert.deepStrictEqual(st(11, 0, 0), [{ type: 'release' }]);
    assert.deepStrictEqual(c.feed({ frontRotaryEncoderPushButton: 'SIGNAL_UNGUELTIG', frontRotaryEncoderDeflection: 'SIGNAL_UNGUELTIG' }), []);
    const w = new Controller(); w.feed({ frontRotaryEncoderOperation: 65534, frontRotaryEncoderPushButton: 0, frontRotaryEncoderDeflection: 0 });
    assert.deepStrictEqual(w.feed({ frontRotaryEncoderOperation: 1, frontRotaryEncoderPushButton: 0, frontRotaryEncoderDeflection: 0 }), [{ type: 'knob', delta: 3 }]);
});

/* ---------- registry.js ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
test('registry: scores keep the best 5, lower-is-better too', () => {
    const s = new Scores(path.join(tmp, 's.json'));
    const hi = { id: 'a', score: {} }, lo = { id: 'b', score: { lower: true } };
    [5, 9, 1, 7, 3, 8].forEach((n, i) => s.add(hi, n, i + 1));
    assert.deepStrictEqual(s.top('a').map((e) => e.score), [9, 8, 7, 5, 3]);
    assert.strictEqual(s.add(hi, 10), 1);
    assert.strictEqual(s.add(hi, 0), 0);
    [300, 200, 250].forEach((n) => s.add(lo, n));
    assert.strictEqual(s.best('b'), 200);
    assert.strictEqual(new Scores(path.join(tmp, 's.json')).best('a'), 10);
    assert.strictEqual(s.best('none'), null);
});
test('registry: store per game', () => {
    const st = new Store(path.join(tmp, 'd.json'));
    st.forGame('a').set('k', { x: 1 });
    assert.deepStrictEqual(new Store(path.join(tmp, 'd.json')).forGame('a').get('k'), { x: 1 });
    assert.strictEqual(st.forGame('b').get('k'), undefined);
});
test('registry: check() finds a bad module', () => {
    assert.ok(check({ id: 'x', title: 'X', create() {} }, 'x').length === 0);
    assert.ok(check({ id: 'x', title: 'X', create() {} }, 'y').length > 0);
    assert.ok(check({ id: 'x', title: 'X', create() {}, needs: ['knob'] }, 'x').length > 0);
    assert.ok(check({ id: 'X_1', title: 'X' }, 'X_1').length >= 2);
});

/* ---------- every game ---------- */
const OPS = ['fillRect', 'roundRect', 'strokeRoundRect', 'gradientRect', 'circle', 'arc', 'line', 'polyline', 'quad',
    'text', 'textWidth', 'alpha', 'clip', 'noclip', 'image', 'fillUnder', 'rampRect', 'card', 'blit', 'clear', 'target'];
function fakeCanvas() {
    const cv = { w: 1600, h: 520, n: 0 };
    const num = (v, what) => assert.ok(typeof v === 'number' && isFinite(v), what + ': not a number (' + v + ')');
    const col = (c) => assert.ok(typeof c === 'string' || (Array.isArray(c) && c.length >= 3) || typeof c === 'number', 'bad colour ' + JSON.stringify(c));
    OPS.forEach((op) => {
        cv[op] = function () {
            cv.n++;
            const a = Array.prototype.slice.call(arguments);
            if (['fillRect', 'roundRect'].indexOf(op) >= 0) { a.slice(0, 4).forEach((v) => num(v, op)); col(a[op === 'fillRect' ? 4 : 5]); }
            if (op === 'line') { a.slice(0, 5).forEach((v) => num(v, op)); col(a[5]); }
            if (op === 'circle') { a.slice(0, 3).forEach((v) => num(v, op)); col(a[3]); }
            if (op === 'quad') { assert.strictEqual(a[0].length, 4, 'quad: 4 points'); a[0].forEach((p) => { num(p[0], op); num(p[1], op); }); col(a[1]); }
            if (op === 'text') { assert.strictEqual(typeof a[0], 'string', 'text: a string, not ' + typeof a[0]); num(a[1], op); num(a[2], op); num(a[3], op); col(a[4]); }
            if (op === 'textWidth') return String(a[0]).length * a[1] * 0.5;
            if (op === 'text') return String(a[0]).length * a[3] * 0.5;
            return cv;
        };
    });
    return cv;
}
const THEME = { bg: '#000000', text: '#ffffff', dim: '#888888', accent: '#ff0000', warn: '#ffaa00', crit: '#ff0000', cold: '#3399ff', panel: '#1a1d22' };

function play(g, opts) {
    let t = 0, ended = null, steer = 0, pedal = 0, seed = opts.seed;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
    const saved = {};
    const api = {
        W: 1600, H: 520, now: () => t, random: rnd, log: { info() {}, warn() {}, error() {} }, theme: () => THEME, style: require(path.join(APP, 'style')),
        best: () => null, top: () => [], store: { get: (k) => saved[k], set: (k, v) => { saved[k] = JSON.parse(JSON.stringify(v)); } },
        end(score) { assert.strictEqual(ended, null, 'end() called twice'); assert.ok(typeof score === 'number' && isFinite(score), 'end(score): a number'); ended = score; },
        steering: () => steer, steerSource: () => opts.source, pedal: () => pedal, pedalSource: () => opts.source,
    };
    const game = g.create(api);
    assert.ok(game && typeof game.update === 'function' && typeof game.draw === 'function', 'create(api) returns { update, draw }');
    const evs = [{ type: 'knob', delta: 1 }, { type: 'knob', delta: -2 }, { type: 'press' }, { type: 'push', dir: 'N' }, { type: 'release' },
        { type: 'push', dir: 'E' }, { type: 'release' }, { type: 'touch', phase: 'down', x: 800, y: 300 }, { type: 'touch', phase: 'move', x: 900, y: 320 },
        { type: 'touch', phase: 'up', x: 900, y: 320 }, { type: 'tap', x: 400, y: 260 }];
    let frames = 0;
    for (; t < opts.ms; t += 16) {
        steer = Math.sin(t / 1300) * 100; pedal = 50 + Math.sin(t / 900) * 50;
        if (frames % 7 === 0 && game.input) game.input(evs[(frames / 7) % evs.length]);
        if (frames === 300 && game.pause) { game.pause(); if (game.resume) game.resume(); }
        if (ended === null) game.update(16);
        const cv = fakeCanvas();
        game.draw(cv);
        frames++;
        if (ended !== null && frames > 2) break;
    }
    return { frames, ended };
}

const only = process.argv[2];
const games = load(path.join(APP, 'games'), { info() {}, warn() {}, error(m, e) { console.log('     ' + m + (e ? ' ' + (e.stack || e) : '')); } });
const folders = fs.readdirSync(path.join(APP, 'games')).filter((n) => fs.existsSync(path.join(APP, 'games', n, 'index.js')));
test('every folder in games/ loads as a game (' + folders.join(', ') + ')', () => assert.deepStrictEqual(games.map((g) => g.id).sort(), folders.slice().sort()));
games.filter((g) => !only || g.id === only).forEach((g) => {
    test(g.id + ': Node 8 syntax (no ?. ?? or object spread)', () => {
        fs.readdirSync(path.join(APP, 'games', g.id)).filter((f) => f.endsWith('.js') && !/^test/.test(f)).forEach((f) => {
            const src = fs.readFileSync(path.join(APP, 'games', g.id, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"/g, "''");
            assert.ok(!/\?\.[a-zA-Z_$[(]/.test(src), f + ': optional chaining ?.');
            assert.ok(!/\?\?/.test(src), f + ': ??');
            assert.ok(!/\{\s*\.\.\./.test(src), f + ': object spread');
        });
    });
    test(g.id + ': no kit or outside require', () => {
        fs.readdirSync(path.join(APP, 'games', g.id)).filter((f) => f.endsWith('.js') && !/^test/.test(f)).forEach((f) => {
            const src = fs.readFileSync(path.join(APP, 'games', g.id, f), 'utf8');
            const reqs = (src.match(/require\(\s*['"][^'"]+['"]\s*\)/g) || []).map((r) => r.replace(/require\(\s*['"]|['"]\s*\)/g, ''));
            reqs.forEach((r) => assert.ok(/^\.\/[^/]+$/.test(r), f + ': require(\'' + r + '\'): only the game\'s own files'));
        });
    });
    if (g.art) test(g.id + ': menu art draws', () => {
        const S = require(path.join(APP, 'style'));
        for (let ms = 0; ms < 20000; ms += 333) g.art(fakeCanvas(), 100, 100, 184, 184, S, ms);
    });
    ['knob', 'wheel'].forEach((source) => test(g.id + ': plays 3 minutes headless (' + source + ')', () => {
        const r = play(g, { ms: 180000, seed: 7, source });
        assert.ok(r.frames > 10);
    }));
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
