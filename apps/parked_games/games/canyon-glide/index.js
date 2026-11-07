'use strict';
/**
 * Canyon Glide - fly a glider through an endless cave. Turn the steering wheel to climb and dive
 * (clockwise tips the nose down, as the glider flies to the right), press the accelerator to boost
 * (engine off). Without them: the shell's knob stand-in steers and push N boosts; taps above /
 * below the glider nudge it, and a knob press fires a short boost. One touch of the rock ends the round.
 *
 * Files: cave.js (the cave), input.js (controls), game.js (rules), draw.js (drawing),
 * autopilot.js (flies by itself: the tests use it), test.js.
 * Interface: apps/parked_games/GAMES.md.
 */
const { Round } = require('./game');
const { draw } = require('./draw');

const FULL_STEER_DEG = 90;      // wheel angle for full climb / dive

class Game {
    constructor(api) {
        this.api = api;
        const best = api.best && api.best();
        const store = api.store;
        this.round = new Round({
            seed: Math.floor(api.random() * 0x7fffffff) + 1,
            best: best == null ? 0 : best,
            invert: !!(store && store.get('invert')),
            log: api.log,
        });
        this.knob = 0; this.press = false; this.tap = null;
        this.ended = false;
    }

    input(ev) {
        if (!ev) return;
        if (ev.type === 'knob') this.knob += Number(ev.delta) || 0;
        else if (ev.type === 'press') this.press = true;
        else if (ev.type === 'tap') this.tap = { x: ev.x, y: ev.y };
    }

    frame() {
        const api = this.api;
        const deg = api.steering ? api.steering() : null, pct = api.pedal ? api.pedal() : null;
        const steerKnob = api.steerSource && api.steerSource() === 'knob';
        const pedalKnob = api.pedalSource && api.pedalSource() === 'knob';
        const inp = {
            steer: typeof deg === 'number' ? deg / FULL_STEER_DEG : null,
            pedal: typeof pct === 'number' ? pct / 100 : null,
            // the knob already turns the stand-in wheel: don't count its clicks twice
            knob: steerKnob ? 0 : this.knob,
            // a press re-centres the stand-in wheel; it boosts only when push N isn't the pedal
            press: this.press && !pedalKnob,
            tap: this.tap,
        };
        this.knob = 0; this.press = false; this.tap = null;
        return inp;
    }

    update(dtMs) {
        if (this.ended) return;
        this.round.update(dtMs, this.frame());
        if (this.round.over()) { this.ended = true; this.api.end(this.round.score()); }
    }

    hints() {
        const api = this.api, s = api.steerSource && api.steerSource(), p = api.pedalSource && api.pedalSource();
        return {
            steer: s === 'wheel' ? 'Turn the wheel: anticlockwise climbs, clockwise dives'
                : s === 'knob' ? 'Turn the knob to climb and dive, press to level out'
                    : 'Tap above or below the glider',
            boost: p === 'pedal' ? 'accelerator pedal' : p === 'knob' ? 'push the controller up' : 'press the knob',
        };
    }

    draw(cv) { draw(cv, this.round, this.api.theme && this.api.theme(), this.hints()); }
}

module.exports = {
    id: 'canyon-glide',
    title: 'Canyon Glide',
    blurb: 'Glide the cave, pedal to boost',
    order: 30,
    needs: ['wheel', 'pedal'],
    score: { unit: 'pts', lower: false },
    create(api) { return new Game(api); },
};
