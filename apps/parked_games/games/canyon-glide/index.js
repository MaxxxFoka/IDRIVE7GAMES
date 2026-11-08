'use strict';
/**
 * Canyon Glide - fly a glider through an endless cave with the iDrive knob: turn it to climb and
 * dive (clockwise tips the nose down, as the glider flies to the right; the trim stays where you
 * leave it), press to level out, hold the controller up to boost. Taps above / below the glider
 * nudge it too. One touch of the rock ends the round.
 *
 * Files: cave.js (the cave), input.js (controls), game.js (rules), draw.js (drawing),
 * autopilot.js (flies by itself: the tests use it), test.js.
 * Interface: apps/parked_games/GAMES.md.
 */
const { Round } = require('./game');
const { draw } = require('./draw');
const look = require('./look');

const HOW = { steer: 'Turn the knob to climb and dive, press to level out', boost: 'hold the controller up' };

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
        this.knob = 0; this.level = false; this.tap = null; this.boost = false;
        this.ended = false;
        this.fx = api.style ? new look.Fx(api.style) : null;
    }

    input(ev) {
        if (!ev) return;
        if (ev.type === 'knob') this.knob += Number(ev.delta) || 0;
        else if (ev.type === 'press') this.level = true;
        else if (ev.type === 'push') this.boost = ev.dir === 'N';
        else if (ev.type === 'release') this.boost = false;
        else if (ev.type === 'tap') this.tap = { x: ev.x, y: ev.y };
    }

    frame() {
        const inp = { knob: this.knob, level: this.level, boost: this.boost ? 1 : 0, tap: this.tap };
        this.knob = 0; this.level = false; this.tap = null;
        return inp;
    }

    update(dtMs) {
        if (this.ended) return;
        this.round.update(dtMs, this.frame());
        if (this.fx) this.fx.update(dtMs, this.round);
        if (this.round.over()) { this.ended = true; this.api.end(this.round.score()); }
    }

    pause() { this.boost = false; }

    hints() { return HOW; }

    draw(cv) {
        if (this.fx) look.draw(cv, this.round, this.api.style, this.fx, this.hints());
        else draw(cv, this.round, this.api.theme && this.api.theme(), this.hints());
    }
}

module.exports = {
    id: 'canyon-glide',
    title: 'Canyon Glide',
    blurb: 'Glide the endless cave',
    order: 30,
    needs: [],
    score: { unit: 'pts', lower: false },
    art: look.art,
    create(api) { return new Game(api); },
};
