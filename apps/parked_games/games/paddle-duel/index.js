'use strict';
/**
 * Paddle Duel: the Parked Games plug-in (interface: apps/parked_games/GAMES.md).
 * The rules and the drawing are in game.js; this file maps the shell's inputs onto the two paddles.
 *
 * You play your paddle with the iDrive knob (each click moves it, push up / down slides it), or with a
 * finger on your half of the screen, against the car. A second player can take the car's paddle by
 * touching the other half: then it's a duel. Your paddle is on the left; pushing the controller right (or left) before the first serve
 * moves it to that side, remembered in the game's store.
 *
 * Score for the high-score table: the longest rally of the match (hits).
 */
const { PaddleDuel, COURT, PADDLE } = require('./game');
const look = require('./draw');

const POINTS = 7;

class Game {
    constructor(api) {
        this.api = api;
        const store = api.store || { get() {}, set() {} };
        this.store = store;
        this.side = store.get('side') === 'R' ? 'R' : 'L';
        this.joined = false;          // a second player has taken the other paddle by touch
        this.ended = false;
        this.g = new PaddleDuel({ target: POINTS, cpu: 'normal', random: api.random || Math.random, left: 'cpu', right: 'cpu' });
        this.assign();
        this.g.newMatch();
        this.fx = api.style ? new look.Fx(api.style) : null;
    }

    get other() { return this.side === 'L' ? 'R' : 'L'; }

    /** who plays which side */
    assign() {
        const g = this.g, me = this.side, o = this.other, names = {};
        const oc = this.joined ? 'touch' : 'cpu';
        names[me] = this.joined ? 'PLAYER 1  ·  KNOB' : 'YOU  ·  KNOB / TOUCH';
        names[o] = this.joined ? 'PLAYER 2  ·  TOUCH' : 'CAR  ·  TOUCH HERE TO PLAY';
        g.hint = this.joined ? null : 'Turn the knob or drag on your half to move your paddle   ·   push up / down to slide it';
        if (g[me].ctl !== 'knob') g.setControl(me, 'knob');
        if (g[o].ctl !== oc) g.setControl(o, oc);
        g.o.left = g.L.ctl; g.o.right = g.R.ctl;
        g.names = names;
    }

    update(dtMs) {
        if (this.ended) return;
        this.g.update(dtMs / 1000);
        if (this.fx) this.fx.update(dtMs);
        this.g.takeEvents().forEach((e) => {
            if (this.fx) this.fx.event(e, this.g);
            if (e[0] !== 'over' || this.ended) return;
            this.ended = true;
            const r = this.g.result();
            if (this.api.log) this.api.log.info('paddle duel: ' + r.L + ':' + r.R + ' (' + this.g.winnerName() + ' wins), longest rally ' + r.longestRally);
            if (this.api.end) this.api.end(r.longestRally);
        });
    }

    draw(cv) {
        if (this.fx) look.draw(cv, this.g, this.api.style, this.fx);
        else this.g.draw(cv, this.api.theme ? this.api.theme() : {});
    }

    input(ev) {
        if (!ev || this.ended || this.g.paused) return;
        const g = this.g;
        switch (ev.type) {
            case 'knob':
                g.knob(ev.delta || 0);
                break;
            case 'push':
                if (ev.dir === 'W' || ev.dir === 'E') { this.swapSides(ev.dir === 'W' ? 'L' : 'R'); return; }
                g.tilt(ev.dir);
                break;
            case 'release':
                g.tilt(null);
                break;
            case 'touch': {
                if (ev.phase === 'up' || ev.y < COURT.top - 20) return;
                // alone, a finger on your own half moves your paddle too. A finger on the other half
                // takes (and moves) the car's paddle: a second player on touch, you stay on the knob
                // (and then your half no longer answers touch, so player 2 can't move your paddle)
                const me = this.side, o = this.other, mine = me === 'L' ? ev.x < 800 : ev.x >= 800;
                if (mine) { if (!this.joined) g[me].setTarget(ev.y); break; }
                if (!this.joined) { this.joined = true; this.assign(); }
                g[o].setTarget(ev.y);
                break;
            }
            default:
                break;
        }
    }

    /** before the first serve: put your (knob) paddle on side s ('L' / 'R') */
    swapSides(s) {
        const g = this.g;
        if (s === this.side || g.hits > 0 || g.L.score + g.R.score > 0) return;
        this.side = s;
        this.store.set('side', s);
        this.assign();
    }

    pause() { this.g.pause(true); this.g.tilt(null); }
    resume() { this.g.pause(false); }
}

module.exports = {
    id: 'paddle-duel',
    title: 'Paddle Duel',
    blurb: 'Knob duel against the car',
    order: 20,
    needs: [],
    score: { unit: 'hits', lower: false },
    art: look.art,
    create(api) { return new Game(api); },
    Game,
    PADDLE,
};
