'use strict';
/**
 * Paddle Duel: the Parked Games plug-in (interface: apps/parked_games/GAMES.md).
 * The rules and the drawing are in game.js; this file maps the shell's inputs onto the two paddles.
 *
 * Who plays which paddle, decided every frame from what the shell offers:
 *
 *   steerSource() 'wheel'  the real wheel is allowed (P, parking brake on): the DRIVER plays their
 *                          side with the wheel. The other side is the car until the passenger turns
 *                          the knob (or touches their half of the screen): then it's a two-player duel.
 *   steerSource() 'knob'   no real wheel (driving rules, the emulator): the shell turns knob clicks
 *                          into a virtual wheel. One player with the knob against the car.
 *   null                   no steering at all: the knob plays the passenger's side directly.
 *
 * The driver sits on the left (left-hand drive). Pushing the controller left or right before the first
 * serve moves the driver's paddle to that side (right-hand drive), remembered in the game's store.
 *
 * Score for the high-score table: the longest rally of the match (hits).
 */
const { PaddleDuel, COURT, PADDLE } = require('./game');

const WHEEL_RANGE = 90;      // real wheel: degrees from centre for full paddle travel (gentle turns)
const KNOB_RANGE = 30;       // virtual wheel (6 degrees a click): 5 clicks from centre to the edge
const POINTS = 7;

class Game {
    constructor(api) {
        this.api = api;
        const store = api.store || { get() {}, set() {} };
        this.store = store;
        this.driver = store.get('driverSide') === 'R' ? 'R' : 'L';
        this.joined = false;          // the passenger has taken their paddle (two-player)
        this.ended = false;
        this.src = undefined;
        this.g = new PaddleDuel({ target: POINTS, cpu: 'normal', random: api.random || Math.random, left: 'cpu', right: 'cpu' });
        this.assign();
        // the wheel's angle now counts as centre: the car may stand with its wheels turned
        const d = this.angle();
        if (this.src === 'wheel' && d !== null) this.g.steer(d);
        this.g.newMatch();
    }

    get passenger() { return this.driver === 'L' ? 'R' : 'L'; }
    angle() { const d = this.api.steering ? this.api.steering() : null; return typeof d === 'number' && isFinite(d) ? d : null; }

    /** who plays which side, from the steering source and whether the passenger joined */
    assign() {
        const src = this.api.steerSource ? this.api.steerSource() : null;
        const g = this.g, d = this.driver, p = this.passenger;
        if (src !== this.src) {
            this.src = src;
            // a new source: centre on where it stands now
            g.wheelZero = src === 'wheel' && this.angle() !== null ? this.angle() : 0;
            g.o.wheelRange = src === 'knob' ? KNOB_RANGE : WHEEL_RANGE;
        }
        const names = {};
        let dc, pc;
        if (src === 'wheel') {
            dc = 'wheel'; pc = this.joined ? 'knob' : 'cpu';
            names[d] = 'DRIVER  ·  WHEEL';
            names[p] = this.joined ? 'PASSENGER  ·  KNOB' : 'CAR  ·  TURN THE KNOB TO PLAY';
            g.hint = this.joined ? null : 'Driver: turn the wheel gently   ·   passenger: turn the knob to join';
        } else if (src === 'knob') {
            dc = 'wheel'; pc = 'cpu';
            names[d] = 'YOU  ·  KNOB'; names[p] = 'CAR';
            g.hint = 'Turn the knob to move   ·   press it to centre the paddle';
        } else {
            dc = 'cpu'; pc = 'knob';
            names[d] = 'CAR'; names[p] = 'YOU  ·  KNOB';
            g.hint = 'Turn the knob to move your paddle';
        }
        if (g[d].ctl !== dc) g.setControl(d, dc);
        if (g[p].ctl !== pc) g.setControl(p, pc);
        g.o.left = g.L.ctl; g.o.right = g.R.ctl;
        g.names = names;
    }

    update(dtMs) {
        if (this.ended) return;
        this.assign();
        const d = this.angle();
        this.g.steer(this.g.byCtl('wheel') ? d : null);
        this.g.update(dtMs / 1000);
        this.g.takeEvents().forEach((e) => {
            if (e[0] !== 'over' || this.ended) return;
            this.ended = true;
            const r = this.g.result();
            if (this.api.log) this.api.log.info('paddle duel: ' + r.L + ':' + r.R + ' (' + this.g.winnerName() + ' wins), longest rally ' + r.longestRally);
            if (this.api.end) this.api.end(r.longestRally);
        });
    }

    draw(cv) { this.g.draw(cv, this.api.theme ? this.api.theme() : {}); }

    /** the passenger's paddle for knob and touch (when the wheel isn't using the knob) */
    knobSide() { return this.src === 'knob' ? null : this.passenger; }

    input(ev) {
        if (!ev || this.ended || this.g.paused) return;
        const g = this.g;
        switch (ev.type) {
            case 'knob':
                if (!this.knobSide()) return;          // the virtual wheel: the shell feeds steering()
                if (this.src === 'wheel' && !this.joined) { this.joined = true; this.assign(); }
                g.knob(ev.delta || 0);
                break;
            case 'push':
                if (ev.dir === 'W' || ev.dir === 'E') { this.swapSides(ev.dir === 'W' ? 'L' : 'R'); return; }
                if (!this.knobSide()) return;
                if (this.src === 'wheel' && !this.joined) { this.joined = true; this.assign(); }
                g.tilt(ev.dir);
                break;
            case 'release':
                g.tilt(null);
                break;
            case 'touch': {
                const side = this.knobSide();
                if (!side || ev.phase === 'up') return;
                // a finger on the passenger's half of the court moves their paddle to it
                const onHalf = side === 'L' ? ev.x < 800 : ev.x >= 800;
                if (!onHalf || ev.y < COURT.top - 20) return;
                if (this.src === 'wheel' && !this.joined) { this.joined = true; this.assign(); }
                g[side].setTarget(ev.y);
                break;
            }
            default:
                break;
        }
    }

    /** before the first serve: put the driver's paddle on side s ('L' / 'R') */
    swapSides(s) {
        const g = this.g;
        if (s === this.driver || g.hits > 0 || g.L.score + g.R.score > 0) return;
        this.driver = s;
        this.store.set('driverSide', s);
        this.src = undefined;                           // re-centre and re-assign
        this.assign();
    }

    pause() { this.g.pause(true); this.g.tilt(null); }
    resume() { this.g.pause(false); }
}

module.exports = {
    id: 'paddle-duel',
    title: 'Paddle Duel',
    blurb: 'Driver on the wheel vs passenger on the knob',
    order: 20,
    needs: ['wheel'],
    score: { unit: 'hits', lower: false },
    create(api) { return new Game(api); },
    Game,
    PADDLE,
};
