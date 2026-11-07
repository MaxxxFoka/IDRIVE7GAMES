'use strict';
/**
 * Lane Runner - steer down an endless road with the steering wheel (or the knob), between cones
 * and barriers, picking up fuel cans. Gentle steering: about 90 degrees each way covers the road.
 * Rules: logic.js. This file draws.
 */
const { Run, ROAD, LANES, LANE_H, CAR, STEER_RANGE, LIVES } = require('./logic');

const W = 1600, H = 520;
const C = {
    grass: '#16241a', grass2: '#1b2c20', road: '#2b2e33', edge: '#d8dadf', dash: '#8b9099',
    car: '#2f7bd8', carHi: '#5fa2f0', glass: '#0e1622', wheel: '#0b0c0e',
    cone: '#ff7a1a', coneHi: '#ffe2c8', barrier: '#d23a32', barrierHi: '#f2f2f2',
    can: '#f2c230', canHi: '#7a5b00', fuel: '#f2c230', low: '#ff4d3d', shadow: [0, 0, 0, 90],
};

class Game {
    constructor(api) {
        this.api = api;
        this.run = new Run(api.random);
        this.flash = 0;        // ms of red flash after a hit
        this.glow = 0;         // ms of yellow glow after a can
        this.scroll = 0;       // lane-dash phase
        this.countdown = 1800; // ms of "get ready" at the start (the logic keeps the road clear meanwhile)
    }

    update(dt) {
        const r = this.run;
        r.step(dt, this.api.steering());
        this.scroll = (this.scroll + r.speed * Math.min(dt, 50) / 1000) % 120;
        this.flash = Math.max(0, this.flash - dt);
        this.glow = Math.max(0, this.glow - dt);
        this.countdown = Math.max(0, this.countdown - dt);
        r.events.forEach((e) => {
            if (e === 'hit') this.flash = 400;
            else if (e === 'can') this.glow = 350;
            else if (e === 'over') { this.flash = 0; this.api.end(r.metres()); }
        });
    }

    input() { /* the steering comes from api.steering(); the shell turns the knob into it where needed */ }

    draw(cv) {
        const r = this.run, t = this.api.theme();
        // verge
        cv.fillRect(0, 0, W, ROAD.top, C.grass);
        cv.fillRect(0, ROAD.bottom, W, H - ROAD.bottom, C.grass);
        for (let x = -((this.scroll * 0.5) % 160); x < W; x += 160) {
            cv.fillRect(x, 46, 60, 8, C.grass2); cv.fillRect(x + 80, ROAD.bottom + 12, 60, 8, C.grass2);
        }
        // road, edges, lane dashes
        cv.fillRect(0, ROAD.top, W, ROAD.bottom - ROAD.top, C.road);
        cv.fillRect(0, ROAD.top, W, 5, C.edge);
        cv.fillRect(0, ROAD.bottom - 5, W, 5, C.edge);
        for (let i = 1; i < LANES; i++) {
            const y = ROAD.top + i * LANE_H - 2;
            for (let x = -this.scroll; x < W; x += 120) cv.fillRect(x, y, 60, 4, C.dash);
        }
        // things
        r.things.forEach((o) => {
            const b = r.box(o);
            if (b.x > W + 60) return;
            if (o.kind === 'cone') this.cone(cv, b);
            else if (o.kind === 'barrier') this.barrier(cv, b);
            else this.can(cv, b);
        });
        this.car(cv, r);
        if (this.flash > 0) cv.fillRect(0, 0, W, H, [255, 40, 30, Math.round(90 * this.flash / 400)]);
        if (this.glow > 0) cv.fillRect(0, ROAD.top, W, ROAD.bottom - ROAD.top, [242, 194, 48, Math.round(50 * this.glow / 350)]);
        this.hud(cv, t, r);
        if (this.countdown > 0) {
            cv.text(String(Math.ceil(this.countdown / 600)), W / 2, H / 2 + 40, 120, t.text, { align: 'center', font: 'num' });
            cv.text(this.api.steerSource() === 'wheel' ? 'Centre the wheel' : 'Turn the knob to steer', W / 2, H / 2 + 100, 28, t.text, { align: 'center', font: 'bold' });
        }
    }

    car(cv, r) {
        const blink = r.invulnerable() && Math.floor(r.t / 120) % 2 === 0;
        if (blink) cv.alpha(0.35);
        // tilt hint: the car leans a little towards where it is going
        const lean = Math.max(-10, Math.min(10, (r.target - r.y) * 0.15));
        const x = CAR.x - CAR.w / 2, y = r.y - CAR.h / 2, w = CAR.w, h = CAR.h;
        cv.roundRect(x + 4, y + 6, w, h, 12, C.shadow);
        // wheels
        [[x + 14, y - 5], [x + w - 34, y - 5], [x + 14, y + h - 5], [x + w - 34, y + h - 5]].forEach((p) => cv.roundRect(p[0], p[1] + (p[0] > x + 40 ? lean * 0.3 : 0), 22, 10, 3, C.wheel));
        cv.roundRect(x, y, w, h, 12, C.car);
        cv.roundRect(x + 8, y + 6, w - 30, 8, 4, C.carHi);
        // windscreen (front = right), rear window, roof
        cv.quad([[x + w - 30, y + 7], [x + w - 16, y + 11], [x + w - 16, y + h - 11], [x + w - 30, y + h - 7]], C.glass);
        cv.roundRect(x + 14, y + 10, 12, h - 20, 4, C.glass);
        cv.roundRect(x + 30, y + 9, w - 64, h - 18, 6, C.carHi);
        // lights
        cv.roundRect(x + w - 6, y + 5, 5, 9, 2, '#fff6d8'); cv.roundRect(x + w - 6, y + h - 14, 5, 9, 2, '#fff6d8');
        cv.roundRect(x, y + 5, 4, 9, 2, '#ff3b30'); cv.roundRect(x, y + h - 14, 4, 9, 2, '#ff3b30');
        if (blink) cv.alpha(1);
    }
    cone(cv, b) {
        const cx = b.x + b.w / 2, base = b.y + b.h;
        cv.roundRect(b.x - 2, base - 8, b.w + 4, 8, 2, C.cone);
        cv.quad([[cx - 4, b.y], [cx + 4, b.y], [b.x + b.w - 4, base - 6], [b.x + 4, base - 6]], C.cone);
        cv.quad([[cx - 9, b.y + 14], [cx + 9, b.y + 14], [cx + 12, b.y + 22], [cx - 12, b.y + 22]], C.coneHi);
    }
    barrier(cv, b) {
        cv.roundRect(b.x + 4, b.y + 6, b.w, b.h, 6, C.shadow);
        cv.roundRect(b.x, b.y, b.w, b.h, 6, C.barrierHi);
        const n = Math.max(2, Math.round(b.h / 28));
        for (let i = 0; i < n; i += 2) cv.fillRect(b.x, b.y + i * b.h / n, b.w, b.h / n, C.barrier);
        cv.strokeRoundRect(b.x, b.y, b.w, b.h, 6, 2, '#5a1210');
    }
    can(cv, b) {
        const bob = Math.sin(this.run.t / 180) * 3;
        cv.roundRect(b.x, b.y + bob, b.w, b.h, 6, C.can);
        cv.roundRect(b.x + b.w - 14, b.y - 6 + bob, 10, 8, 2, C.can);
        cv.line(b.x + 7, b.y + 9 + bob, b.x + b.w - 7, b.y + b.h - 9 + bob, 4, C.canHi);
        cv.line(b.x + b.w - 7, b.y + 9 + bob, b.x + 7, b.y + b.h - 9 + bob, 4, C.canHi);
    }

    hud(cv, t, r) {
        // distance, top left (over the verge)
        cv.text(String(r.metres()), 24, 86, 40, t.text, { font: 'num' });
        const mw = cv.textWidth(String(r.metres()), 40, { font: 'num' });
        cv.text('m', 32 + mw, 86, 22, t.dim, { font: 'label' });
        const best = this.api.best();
        if (best !== null) cv.text('best ' + best + ' m', 110 + mw, 84, 20, t.dim, { font: 'label' });
        // speed
        cv.text(String(r.kmh()), 760, 86, 36, t.text, { font: 'num', align: 'right' });
        cv.text('km/h', 770, 84, 20, t.dim, { font: 'label' });
        // fuel gauge
        const fx = 900, fw = 260, low = r.fuel < 0.25;
        cv.text('FUEL', fx, 82, 20, low && Math.floor(r.t / 300) % 2 ? C.low : t.dim, { font: 'bold' });
        cv.roundRect(fx + 64, 66, fw, 18, 6, [0, 0, 0, 120]);
        cv.roundRect(fx + 64, 66, Math.max(6, fw * r.fuel), 18, 6, low ? C.low : C.fuel);
        // lives
        for (let i = 0; i < LIVES; i++) cv.roundRect(1250 + i * 46, 64, 36, 20, 6, i < r.lives ? C.car : [255, 255, 255, 40]);
        // steering: a little wheel, top right, turned as the input is
        this.wheel(cv, t, 1540, 72, 20);
        // the bottom verge: what to dodge
        cv.text('Dodge cones and barriers, grab fuel', W - 16, H - 10, 16, t.dim, { font: 'label', align: 'right' });
    }
    wheel(cv, t, cx, cy, rad) {
        const s = this.api.steering();
        const a = Math.max(-STEER_RANGE, Math.min(STEER_RANGE, s || 0));
        cv.arc(cx, cy, rad - 5, rad, 0, 360, t.dim);
        // the spoke shows the angle: straight up at 0 (the arc's 0 degrees is up, clockwise positive)
        const rr = (a - 90) * Math.PI / 180;
        cv.line(cx, cy, cx + Math.cos(rr) * (rad - 4), cy + Math.sin(rr) * (rad - 4), 4, Math.abs(s || 0) > STEER_RANGE ? C.low : t.accent);
        cv.circle(cx, cy, 5, t.accent);
        cv.text(this.api.steerSource() === 'wheel' ? 'WHEEL' : 'KNOB', cx - rad - 8, cy + 8, 16, t.dim, { font: 'bold', align: 'right' });
    }
}

module.exports = {
    id: 'lane-runner',
    title: 'Lane Runner',
    blurb: 'Steer between the cones',
    order: 10,
    needs: ['wheel'],
    score: { unit: 'm', lower: false },
    create(api) { return new Game(api); },
};
