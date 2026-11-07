'use strict';
/**
 * Lane Runner, realistic look: HD textures (assets/*.tex, made by make_textures.py) for the road,
 * the verges, the car and everything on the road, a smoked-glass HUD in the style of a digital
 * instrument cluster, dust and debris on hits. game.js-free: it reads the Game's state and draws.
 */
const { ROAD, LANES, CAR, STEER_RANGE, LIVES } = require('./logic');

const W = 1600, H = 520;
const TILE = 480, VERGE_H = 64;
const WHITE = '#f4f6f9', SOFT = [244, 246, 249, 150], FAINT = [244, 246, 249, 70], BLUE = '#3f8cff', AMBER = '#ffb020', RED = '#ff4b4b';

class Real {
    constructor(game) {
        const api = game.api;
        this.g = game;
        this.t = {};
        ['road', 'verge-top', 'verge-bottom', 'car', 'cone', 'barrier', 'can'].forEach((n) => { this.t[n] = api.texture ? api.texture('assets/' + n + '.tex') : null; });
    }
    ok() { return !!(this.t.road && this.t.car); }

    draw(cv) {
        const G = this.g, r = G.run, S = G.S, T = this.t, ox = G.shake.x, oy = G.shake.y;
        const ph = G.scroll % TILE;
        cv.clip(0, 0, W, H);             // pictures are not cut at the page's edge by themselves
        // verges and road, tiled and scrolling
        cv.fillRect(0, 0, W, ROAD.top - VERGE_H + oy + 1, '#24361f');
        for (let x = -ph - 16; x < W + 16; x += TILE) {
            const tx = Math.round(x + ox);
            if (T['verge-top']) cv.image(T['verge-top'].id, tx, ROAD.top - VERGE_H + oy, TILE + 1, VERGE_H);
            cv.image(T.road.id, tx, ROAD.top + oy, TILE + 1, ROAD.bottom - ROAD.top);
            if (T['verge-bottom']) cv.image(T['verge-bottom'].id, tx, ROAD.bottom + oy, TILE + 1, VERGE_H);
        }
        // things, then the car
        r.things.forEach((o) => {
            if (o.gone) return;
            const b = r.box(o), cx = b.x + b.w / 2 + ox, cy = b.y + b.h / 2 + oy;
            if (cx > W + 80) return;
            if (o.kind === 'cone' && T.cone) cv.image(T.cone.id, cx - 36, cy - 36, 72, 72);
            else if (o.kind === 'barrier' && T.barrier) { const bh = b.h + 22; cv.image(T.barrier.id, cx - 26, cy - bh / 2, 52, bh); }
            else if (o.kind === 'can' && T.can) {
                const bob = Math.sin(r.t / 220) * 2;
                cv.circle(cx, cy + 4, 34, [255, 214, 90, Math.round(26 + 14 * Math.sin(r.t / 160))]);
                cv.image(T.can.id, cx - 25, cy - 28 + bob, 50, 56);
            }
        });
        this.car(cv, r, ox, oy);
        G.fx.draw(cv, ox, oy);
        G.pops.draw(cv, ox, oy);
        // a hit: a short red edge glow; a can: a soft warm wash
        if (G.hitK > 0) {
            const k = G.hitK;
            cv.gradientRect(0, ROAD.top, W, 70, [[0, [255, 40, 40, Math.round(110 * k)]], [1, [255, 40, 40, 0]]]);
            cv.gradientRect(0, ROAD.bottom - 70, W, 70, [[0, [255, 40, 40, 0]], [1, [255, 40, 40, Math.round(110 * k)]]]);
        }
        if (G.canK > 0) cv.fillRect(0, ROAD.top, W, ROAD.bottom - ROAD.top, [255, 220, 120, Math.round(28 * G.canK)]);
        // light: late sun from the top left, a soft vignette
        cv.gradientRect(0, ROAD.top, W, 120, [[0, [255, 236, 200, 22]], [1, [255, 236, 200, 0]]]);
        cv.rampRect(0, 0, 260, H, 0, [[0, 0, 0, 90], [0, 0, 0, 0]]);
        cv.rampRect(W - 200, 0, 200, H, 0, [[0, 0, 0, 0], [0, 0, 0, 70]]);
        this.hud(cv, r, S);
        if (G.countdown > 0) this.countdown(cv, G.countdown);
        cv.noclip();
    }

    car(cv, r, ox, oy) {
        const blink = r.invulnerable() && Math.floor(r.t / 110) % 2 === 0;
        const x = CAR.x - 66 + 4 + ox, y = r.y - 38 + oy;
        if (blink) cv.alpha(0.45);
        cv.image(this.t.car.id, x, y, 132, 76);
        if (blink) cv.alpha(1);
    }

    hud(cv, r, S) {
        const G = this.g, y0 = 44, h = 50;
        // smoked glass over the top verge
        cv.gradientRect(0, y0 - 4, W, h + 8, [[0, [6, 8, 12, 215]], [1, [6, 8, 12, 165]]]);
        cv.fillRect(0, y0 + h + 3, W, 1, [255, 255, 255, 38]);
        cv.rampRect(0, y0 + h + 3, W, 2, 0, [[63, 140, 255, 0], [63, 140, 255, 200], [63, 140, 255, 0]]);
        const base = y0 + 38;
        // distance (the score) and the best
        const dw = cv.text(String(r.metres()), 24, base, 40, WHITE, { font: 'num' });
        cv.text('m', 30 + dw, base, 18, SOFT, { font: 'label' });
        const best = G.api.best();
        if (best !== null) {
            cv.text('BEST', 130 + dw, base - 18, 13, FAINT, { font: 'bold', spacing: 2 });
            cv.text(best + ' m', 130 + dw, base, 20, SOFT, { font: 'label' });
        }
        // speed, centred like a cluster's
        const sw = cv.text(String(r.kmh()), 800, base + 2, 44, WHITE, { font: 'num', align: 'center' });
        cv.text('km/h', 800 + sw / 2 + 8, base, 16, SOFT, { font: 'label' });
        // fuel: a thin bar with quarter ticks
        const fx = 1010, fw = 240, low = r.fuel < 0.25, blink = low && Math.floor(r.t / 300) % 2;
        cv.text('FUEL', fx, base - 18, 13, blink ? RED : FAINT, { font: 'bold', spacing: 2 });
        cv.roundRect(fx, base - 8, fw, 6, 3, [255, 255, 255, 30]);
        cv.roundRect(fx, base - 8, Math.max(6, fw * G.fuelShown), 6, 3, low ? RED : WHITE);
        for (let i = 1; i < 4; i++) cv.fillRect(fx + fw * i / 4, base - 12, 1, 14, [255, 255, 255, 60]);
        // cars left: the car itself, small
        for (let i = 0; i < LIVES; i++) {
            if (i >= r.lives) cv.alpha(0.22);
            cv.image(this.t.car.id, 1290 + i * 54, base - 26, 52, 30);
            if (i >= r.lives) cv.alpha(1);
        }
        // steering: a thin ring with the angle
        const s = G.api.steering(), a = Math.max(-STEER_RANGE, Math.min(STEER_RANGE, s || 0)), cx = 1548, cy = y0 + 25;
        cv.arc(cx, cy, 17, 19, 0, 360, [255, 255, 255, 50]);
        cv.arc(cx, cy, 16, 20, Math.min(0, a), Math.max(0, a), Math.abs(s || 0) > STEER_RANGE ? RED : BLUE, { round: true });
        const rr = (a - 90) * Math.PI / 180;
        cv.line(cx, cy, cx + Math.cos(rr) * 13, cy + Math.sin(rr) * 13, 3, WHITE);
        cv.text(G.api.steerSource() === 'wheel' ? 'WHEEL' : 'KNOB', cx - 30, cy + 5, 12, FAINT, { font: 'bold', spacing: 2, align: 'right' });
    }

    countdown(cv, ms) {
        const S = this.g.S, cx = W / 2, cy = (ROAD.top + ROAD.bottom) / 2 - 10, step = 600;
        const n = Math.ceil(ms / step), f = 1 - (ms % step) / step;
        cv.circle(cx, cy, 86, [6, 8, 12, 170]);
        cv.arc(cx, cy, 82, 84, 0, 360, [255, 255, 255, 40]);
        cv.arc(cx, cy, 81, 85, 0, 360 * (1 - f), WHITE, { round: true });
        const sc = 0.7 + 0.3 * S.ease.back(f * 2.5);
        cv.alpha(S.clamp01(1.4 - f));
        cv.text(String(n), cx, cy + 34 * sc, Math.round(96 * sc), WHITE, { font: 'num', align: 'center' });
        cv.alpha(1);
        cv.text(this.g.api.steerSource() === 'wheel' ? 'CENTRE THE WHEEL' : 'TURN THE KNOB TO STEER', cx, cy + 124, 16, SOFT, { font: 'bold', spacing: 3, align: 'center' });
    }
}

/** The menu tile in the realistic look: the road and the car, scrolling */
function artReal(cv, x, y, w, h, S, ms, tex) {
    const road = tex('assets/road.tex'), car = tex('assets/car.tex'), cone = tex('assets/cone.tex');
    if (!road || !car) return false;
    const rh = h, k = rh / 390, tw = TILE * k, ph = (ms * 0.08) % tw;
    for (let tx = x - ph; tx < x + w; tx += tw) cv.image(road.id, tx, y, tw + 1, rh);
    const cy = y + h / 2 + 18 * Math.sin(ms / 1100);
    if (cone) {
        const kx = x + w - ((ms * 0.08) % (w + 60));
        cv.image(cone.id, kx, y + h * 0.22, 34, 34);
        cv.image(cone.id, kx + 46, y + h * 0.66, 34, 34);
    }
    cv.image(car.id, x + w * 0.12, cy - 25, 88, 51);
    cv.rampRect(x, y, w, h, 0, [[0, 0, 0, 60], [0, 0, 0, 0], [0, 0, 0, 60]]);
    return true;
}

module.exports = { Real, artReal };
