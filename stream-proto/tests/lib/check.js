// a tiny test reporter: check(ok, what) collects; done(name) prints PASS / FAIL and exits with the right code
const fails = [], notes = [];
function check(ok, what) { if (!ok) fails.push(what); return !!ok; }
function note(s) { notes.push(s); }
function done(name) {
  for (const n of notes) console.log("   " + n);
  if (fails.length) { console.log(`FAIL ${name}`); for (const f of fails) console.log("   x " + f); process.exit(1); }
  console.log(`PASS ${name}`); process.exit(0);
}
module.exports = { check, note, done };
