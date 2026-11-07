'use strict';
/**
 * input.js - Canyon Glide: turns the frame's input into the glider's controls.
 *
 * Frame input (index.js builds it from the shell's api and events each update):
 *   steer  -1..1 or null   steering wheel, api.steering() / 90: +1 = turned 90 degrees clockwise
 *                          (right). From the real wheel, or the shell's knob-driven stand-in.
 *   pedal  0..1 or null    accelerator, api.pedal() / 100 (the shell allows it only with the engine
 *                          off; its knob stand-in is push N = 100 %)
 *   knob   integer         knob clicks this frame (+ = clockwise), only when the knob isn't already
 *                          driving the shell's stand-in wheel
 *   press  bool            the knob was pressed this frame (a short boost)
 *   tap    {x, y} or null  a tap on the game (1600 x 520 px)
 *
 * Out: pitch -1..1 (+1 = climb hard, -1 = dive hard) and boost 0..1 (wanted; the game limits it
 * by the boost energy left).
 *
 * The glider turns the way the wheel does: it flies to the right, so turning the wheel clockwise
 * tips its nose down (dive) and anticlockwise lifts it (climb). Setting `invert` swaps that.
 * The knob works the same way (clockwise = dive) and taps above / below the glider nudge it up / down;
 * both are nudges that fade back to level flight. A knob press fires a short boost.
 */
const { clamp } = require('./cave');

const DEAD = 0.05;              // wheel dead zone (fraction of full scale)
const KNOB_STEP = 0.22;         // pitch per knob click
const NUDGE_FADE = 1.6;         // knob / tap nudge fades at this much pitch per second
const TAP_NUDGE = 0.8;
const PRESS_BOOST_S = 1.2;      // a knob press boosts this long

class Input {
    constructor(opts) {
        this.invert = !!(opts && opts.invert);
        this.nudge = 0;             // knob / tap pitch, fading to 0
        this.pressBoost = 0;        // seconds of press boost left
        this.source = 'knob';       // what steered last: 'wheel' | 'knob' | 'touch' (shown in the HUD)
        this.pedalSeen = false;
    }

    reset() { this.nudge = 0; this.pressBoost = 0; }

    /** dt in s; inp as above; gliderY = the glider's screen y (for taps). Returns { pitch, boost } */
    update(dt, inp, gliderY) {
        inp = inp || {};
        const sign = this.invert ? -1 : 1;
        // knob and taps: nudges that fade
        if (inp.knob) { this.nudge = clamp(this.nudge - sign * inp.knob * KNOB_STEP, -1, 1); this.source = 'knob'; }
        if (inp.tap && typeof inp.tap.y === 'number') {
            this.nudge = clamp(this.nudge + (inp.tap.y < gliderY ? TAP_NUDGE : -TAP_NUDGE), -1, 1);
            this.source = 'touch';
        }
        const f = NUDGE_FADE * dt;
        this.nudge = Math.abs(this.nudge) <= f ? 0 : this.nudge - Math.sign(this.nudge) * f;

        // wheel: an absolute position, so it adds to the nudge while it is out of the dead zone
        let wheel = 0;
        if (typeof inp.steer === 'number' && isFinite(inp.steer)) {
            const s = clamp(inp.steer, -1, 1), a = Math.abs(s);
            if (a > DEAD) {
                wheel = -sign * Math.sign(s) * (a - DEAD) / (1 - DEAD);
                this.source = 'wheel';
            }
        }
        const pitch = clamp(wheel + this.nudge, -1, 1);

        // boost: the pedal (engine off), or a knob press for a short burst
        if (inp.press) this.pressBoost = PRESS_BOOST_S;
        this.pressBoost = Math.max(0, this.pressBoost - dt);
        let boost = this.pressBoost > 0 ? 1 : 0;
        if (typeof inp.pedal === 'number' && isFinite(inp.pedal)) {
            this.pedalSeen = true;
            const p = clamp((inp.pedal - 0.05) / 0.9, 0, 1);       // a resting foot doesn't boost
            boost = Math.max(boost, p);
        }
        return { pitch: pitch, boost: boost };
    }
}

module.exports = { Input, DEAD, KNOB_STEP };
