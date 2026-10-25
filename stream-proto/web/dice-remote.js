// dice-remote.js — stand-in for dice.js.
// The die is read by dice_reader.py (round tray, angled camera, OpenCV). This file only listens
// to it, and offers the same API as dice.js, so game.html just changes its import line:
//
//   import { createDiceReader } from "./dice-remote.js";
//
// Start dice_reader.py BEFORE opening the game. If the reader isn't running, start() fails the
// same way a missing camera does, and the game falls back to buttons / number keys.

const PORT = 8767;                                   // must match dice_reader.py --port
const EVENTS = `http://localhost:${PORT}/events`;

export const DEFAULTS = {};
export function loadSettings() { return {}; }
export function saveSettings() {}

export function createDiceReader({ onRoll = () => {}, onState = () => {} } = {}) {
  let es = null, state = "";
  const setState = (s) => { if (s !== state) { state = s; onState(s); } };

  function start() {                                 // the camera id the game passes is ignored:
    stop();                                          // dice_reader.py owns the dice camera
    return new Promise((resolve, reject) => {
      let opened = false;
      es = new EventSource(EVENTS);
      es.onopen = () => { if (!opened) { opened = true; resolve(); } };
      es.addEventListener("state", (e) => setState(JSON.parse(e.data).state));
      es.addEventListener("roll", (e) => onRoll(JSON.parse(e.data).value));
      es.onerror = () => {
        if (!opened) {
          stop();
          console.warn(`[dice] dice_reader.py isn't running on port ${PORT}`);
          reject(new Error("dice reader not running"));
        } else {
          setState("off");                           // reconnects by itself when the reader is back
        }
      };
    });
  }

  function stop() { if (es) { es.close(); es = null; } }

  function draw(canvas) {                            // the picture lives in the Python window
    const c = canvas.getContext("2d");
    c.fillStyle = "#111"; c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "#fff"; c.font = "14px sans-serif";
    c.fillText("The die is read by dice_reader.py", 12, 24);
  }

  const api = {
    start, stop, draw, settings: {}, captureEmpty() {},
    get running() { return !!es; },
    get state() { return state; },
  };
  // anything else the game calls on dice.js becomes a harmless no-op
  return new Proxy(api, {
    get: (t, k) => (k in t ? t[k] : (k === "then" || typeof k !== "string") ? undefined : () => {}),
  });
}
