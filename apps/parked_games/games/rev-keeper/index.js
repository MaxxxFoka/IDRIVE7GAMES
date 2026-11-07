'use strict';
/**
 * Rev Keeper - a Parked Games game (interface: apps/parked_games/GAMES.md).
 *
 * Keep the needle inside a green zone that keeps moving, using only accelerator pedal pressure.
 * The shell gives the real pedal only in P with the parking brake on and the engine off; anywhere
 * else it stands in with the knob (5 % a click), so the game plays everywhere.
 *
 * Rules: logic.js. Picture: draw.js. Tests: node apps/parked_games/games/rev-keeper/test.js
 */
const { RevKeeper } = require('./logic');
const { draw } = require('./draw');

class Game {
    constructor(api) {
        this.api = api;
        this.paused = false;
        this.ended = false;
        this.g = new RevKeeper({
            random: api.random,
            onOver: (score) => { if (!this.ended) { this.ended = true; api.end(score); } },
        });
    }

    update(dtMs) {
        const p = this.api.pedal();
        this.g.setInput(p == null ? 0 : p / 100);
        this.g.update(dtMs / 1000);
    }

    draw(cv) {
        const best = this.api.best();
        draw(cv, this.g, { best: best == null ? null : best, source: this.api.pedalSource(), paused: this.paused });
    }

    // the pedal is read in update; the knob is the shell's pedal stand-in, so no events are needed
    input() {}
    pause() { this.paused = true; }
    resume() { this.paused = false; }
}

module.exports = {
    id: 'rev-keeper',
    title: 'Rev Keeper',
    blurb: 'Rev into the moving green',
    order: 40,
    needs: ['pedal'],
    score: { unit: 'pts', lower: false },
    create(api) { return new Game(api); },
};
