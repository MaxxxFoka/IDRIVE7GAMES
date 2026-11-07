# Paddle Duel

A two-player ball-and-paddle game for the parked car, part of Parked Games
(interface: [`../../GAMES.md`](../../GAMES.md)). Original design.

## Who plays

| The shell's steering source | Left paddle (driver, LHD) | Right paddle |
|---|---|---|
| `wheel` (P + parking brake) | the **steering wheel**: its angle is the paddle's position, ±90° for the full travel, centred on the angle at the start of the match | the car, until the passenger turns the **iDrive knob** or touches the right half of the screen; then it's a duel |
| `knob` (no real wheel: emulator, rules not met) | you, with the knob (the shell's virtual wheel, 5 clicks from the centre to the edge; a press re-centres) | the car |
| none | the car | you, with the knob directly |

Push the controller left or right before the first serve to put the driver's paddle on that side
(right-hand-drive cars). It is remembered.

## Rules

- First to 7 points. The score saved to the high-score table is the match's **longest rally**.
- Where the ball meets the paddle sets the angle it leaves at: the edge sends it steep.
- A paddle that is moving at the hit puts **spin** on the ball, and the ball curves in flight.
- Every hit is a little faster; every 6th hit of a rally is a **hot shot** (red, much faster).
- After the first point a **bumper** drifts up and down the centre line and knocks the ball off course.
- The car's own player aims worse the faster the ball goes, so long rallies end.

## Files

- `game.js`: the rules and the drawing (no shell, no kit), testable with plain node
- `index.js`: the plug-in: maps the shell's inputs onto the paddles
- `test.js`: `node apps/parked_games/games/paddle-duel/test.js`

## Still to check on the car

- Which way the real wheel's sign runs (the shell promises + = right; turning right moves the paddle down).
- Whether ±90° feels right without power assist (engine off); `WHEEL_RANGE` in `index.js`.
