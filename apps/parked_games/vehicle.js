'use strict';
/**
 * vehicle.js - what the car allows the games to use right now (pure logic: main.js feeds it signals).
 *
 *   const v = new Vehicle();
 *   v.speed(kmh) / v.stage('P') / v.handbrake(true) / v.rpm(n) / v.steerRaw(raw) / v.pedalRaw(raw)
 *   v.state(opts) -> { moving, wheel, pedal, why: { wheel, pedal } }
 *
 * The rules (GAMES.md):
 *   - the app plays only while the car stands (<= 3 km/h; no speed at all = a bench, counts as standing)
 *   - the steering wheel only in P with the parking brake applied
 *   - the pedal as the wheel, and only with the engine off
 * Unknown values (a signal that never came) never unlock the wheel or the pedal.
 */
const MAX_KMH = 3;
const ENGINE_OFF_RPM = 400;            // a stopping hybrid leaves its run-down value (kit/runtime/car.js)
const STEER_DEG = 0.04395;             // ActualSteeringAngleDriver: signed 16 bit, + = left
const PEDAL_PCT = 0.025;               // AngleAcceleratorPedal

// selector position, names or wire numbers: statusGearboxDrive.statusActualStageDrive (P = 1, R = 2, N = 3, D = 4)
const STAGES = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' };
// DataPowerTrain2.statusGearSelectionDrive (N = 1, R = 2, P = 3, NP = 4, _1 = 5 ...)
function selection(x) {
    const n = typeof x === 'number' ? x : { N: 1, R: 2, P: 3, NP: 4 }[x] || (/^_\d$/.test(String(x)) ? 4 + Number(String(x).slice(1)) : 0);
    return { 1: 'N', 2: 'R', 3: 'P' }[n] || (n >= 5 && n <= 13 ? 'D' : undefined);
}
// CDS.statusHandBrake.statusContactHandBrake
const BRAKE = { HANDBREMSE_ANGEZOGEN: true, HANDBREMSE_GELOEST: false, 1: false, 2: true };

class Vehicle {
    constructor() {
        this.kmh = null; this.sel = null; this.brake = null; this.engine = null; this.steerDeg = null; this.pedalPct = null; this.running = null;
    }
    /* ---------- feeds (already decoded values) ---------- */
    speed(kmh) { if (typeof kmh === 'number' && isFinite(kmh)) this.kmh = kmh; }
    stage(s) { const v = STAGES[s]; if (v) this.sel = v; }
    handbrake(on) { if (typeof on === 'boolean') this.brake = on; }
    rpm(n) { if (typeof n === 'number' && isFinite(n)) this.engine = n; }
    /** CDS.statusEngineStatus.statusEngineRunDrive: MOTOR_AUS / MOTOR_STARTET / MOTOR_LAEUFT (0 / 1 / 2) */
    engineStatusRaw(v) {
        const x = v && v.statusEngineRunDrive;
        const n = typeof x === 'number' ? x : { MOTOR_AUS: 0, MOTOR_STARTET: 1, MOTOR_LAEUFT: 2 }[x];
        if (n === 0 || n === 1 || n === 2) this.running = n !== 0;
    }
    /* ---------- feeds (raw SOME/IP structs) ---------- */
    speedRaw(v) { const k = v && v.speedVehicleCentreOfGravity; if (typeof k === 'number' && k !== 65535) this.speed(k * 0.015625); }
    gearboxRaw(v) { if (v) this.stage(v.statusActualStageDrive); }
    selectionRaw(v) { const s = v && selection(v.statusGearSelectionDrive); if (s) this.sel = s; }
    handbrakeRaw(v) { const b = v && BRAKE[v.statusContactHandBrake]; this.handbrake(b); }
    rpmRaw(v) { const r = v && v.actualValueRPMEngineCrankshaft; if (typeof r === 'number' && r !== 65535) this.rpm(r * 0.25); }
    /** + = turned right (clockwise): the car's angle is + = left. reversed: a car that counts the other way. */
    steerRaw(v, reversed) {
        let r = v && (typeof v === 'number' ? v : v.actualValueSteeringAngleDriver);
        if (typeof r !== 'number' || r === 0x7fff || r === 0x8000 || r === 0xffff) return;
        if (r > 32767) r -= 65536;
        const deg = -r * STEER_DEG;
        if (Math.abs(deg) > 1000) return;
        this.steerDeg = reversed ? -deg : deg;
    }
    pedalRaw(v) {
        const r = v && (typeof v === 'number' ? v : v.actualValueAngleAcceleratorPedal);
        if (typeof r !== 'number' || r < 0) return;
        const p = r * PEDAL_PCT;
        if (p > 110) return;                           // invalid marks
        this.pedalPct = Math.max(0, Math.min(100, p));
    }

    /* ---------- what's allowed ---------- */
    /** opts: { parkedOnly (default true), wheel ('auto' | 'off') } */
    state(opts) {
        const o = Object.assign({ parkedOnly: true, wheel: 'auto' }, opts);
        const moving = o.parkedOnly !== false && this.kmh !== null && this.kmh > MAX_KMH;
        const standing = this.kmh !== null && this.kmh <= MAX_KMH;
        let wheelWhy = null;
        if (o.wheel === 'off') wheelWhy = 'turned off in Settings';
        else if (this.steerDeg === null) wheelWhy = 'no steering signal';
        else if (!standing) wheelWhy = this.kmh === null ? 'no speed signal' : 'the car is moving';
        else if (this.sel !== 'P') wheelWhy = 'needs gear P';
        else if (this.brake !== true) wheelWhy = 'needs the parking brake';
        let pedalWhy = null;
        if (o.wheel === 'off') pedalWhy = 'turned off in Settings';
        else if (this.pedalPct === null) pedalWhy = 'no pedal signal';
        else if (wheelWhy && wheelWhy !== 'no steering signal') pedalWhy = wheelWhy;
        else if (!standing) pedalWhy = 'the car is moving';
        else if (this.sel !== 'P') pedalWhy = 'needs gear P';
        else if (this.brake !== true) pedalWhy = 'needs the parking brake';
        else if (this.running === true || (this.running === null && this.engine !== null && this.engine >= ENGINE_OFF_RPM)) pedalWhy = 'needs the engine off';
        return { moving, wheel: !wheelWhy, pedal: !pedalWhy, why: { wheel: wheelWhy, pedal: pedalWhy } };
    }
}

module.exports = { Vehicle, selection, MAX_KMH, ENGINE_OFF_RPM, STEER_DEG, PEDAL_PCT };
