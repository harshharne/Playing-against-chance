// The game's two typefaces: one for the EVENTS (the event's name, what happened, the die's number, the narrative
// window) and one for the OPTIONS (the cards / the options along the bottom, the one you picked, what chance gave
// instead). Chosen on /panel (SCREEN: Event font, Option font). All bundled in web/fonts (open font licences there),
// so nothing loads from the internet at the venue.
//
//   import { TYPEFACES, applyTypefaces } from "./typefaces.js"
//   applyTypefaces("noto-serif-display", "plex-mono")    sets --font-event / --font-option on the page
//
// "wide": the face has narrow widths (a width axis). The fog's tall letter (one letter per block, much taller and
// narrower) needs them; with any other face that letter stays the size of the others.

export const TYPEFACES = {
  "noto-serif-display": { name: "Noto Serif Display", css: '"PAC Display", "Noto Serif Display", "Didot", serif', wide: true },
  "instrument-serif": { name: "Instrument Serif", css: '"PAC Instrument Serif", "Instrument Serif", Georgia, serif' },
  "fraunces": { name: "Fraunces", css: '"PAC Fraunces", "Fraunces", Georgia, serif' },
  "plex-mono": { name: "IBM Plex Mono", css: '"PAC Plex Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace' },
  "space-grotesk": { name: "Space Grotesk", css: '"PAC Space Grotesk", "Space Grotesk", ui-sans-serif, system-ui, sans-serif' },
  "inter-tight": { name: "Inter Tight", css: '"PAC Inter Tight", "Inter Tight", "Inter", ui-sans-serif, system-ui, sans-serif' },
  "doto": { name: "Doto (dot matrix)", css: '"PAC Doto", "Doto", ui-monospace, monospace' },
};
export const DEFAULT_EVENT = "noto-serif-display", DEFAULT_OPTION = "plex-mono";

const FACES = `
@font-face { font-family: "PAC Display"; src: url("fonts/noto-serif-display-latin-wdth-normal.woff2") format("woff2"); font-weight: 100 900; font-stretch: 62.5% 100%; font-display: block; }
@font-face { font-family: "PAC Display"; src: url("fonts/noto-serif-display-latin-wdth-italic.woff2") format("woff2"); font-weight: 100 900; font-stretch: 62.5% 100%; font-style: italic; font-display: block; }
@font-face { font-family: "PAC Instrument Serif"; src: url("fonts/instrument-serif-normal.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
@font-face { font-family: "PAC Instrument Serif"; src: url("fonts/instrument-serif-italic.woff2") format("woff2"); font-weight: 100 900; font-style: italic; font-display: block; }
@font-face { font-family: "PAC Fraunces"; src: url("fonts/fraunces-var.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
@font-face { font-family: "PAC Plex Mono"; src: url("fonts/plex-mono-300.woff2") format("woff2"); font-weight: 100 349; font-display: block; }
@font-face { font-family: "PAC Plex Mono"; src: url("fonts/plex-mono-400.woff2") format("woff2"); font-weight: 350 449; font-display: block; }
@font-face { font-family: "PAC Plex Mono"; src: url("fonts/plex-mono-500.woff2") format("woff2"); font-weight: 450 549; font-display: block; }
@font-face { font-family: "PAC Plex Mono"; src: url("fonts/plex-mono-600.woff2") format("woff2"); font-weight: 550 900; font-display: block; }
@font-face { font-family: "PAC Space Grotesk"; src: url("fonts/space-grotesk-wght.woff2") format("woff2"); font-weight: 300 700; font-display: block; }
@font-face { font-family: "PAC Inter Tight"; src: url("fonts/inter-tight-latin-wght-normal.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
@font-face { font-family: "PAC Doto"; src: url("fonts/doto-latin-full-normal.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
/* the fog's tall letter needs a face with narrow widths: with any other it stays the size of the rest */
:root[data-ev-plain] .art:not(.o) .tall, :root[data-op-plain] .art.o .tall { font-size: 1em; font-stretch: 100%; transform: none; line-height: inherit; margin: 0; }
`;
let injected = false;
function inject() {
  if (injected || typeof document === "undefined") return;
  const st = document.createElement("style"); st.id = "pac-typefaces"; st.textContent = FACES;
  document.head.appendChild(st); injected = true;
}
// -> a promise that resolves when both faces are ready to measure (the fog fits its letters to their real widths)
export function applyTypefaces(ev, op) {
  inject();
  const E = TYPEFACES[ev] || TYPEFACES[DEFAULT_EVENT], O = TYPEFACES[op] || TYPEFACES[DEFAULT_OPTION];
  const r = document.documentElement;
  r.style.setProperty("--font-event", E.css); r.style.setProperty("--font-option", O.css);
  r.toggleAttribute("data-ev-plain", !E.wide); r.toggleAttribute("data-op-plain", !O.wide);
  const fam = (f) => f.css.split(",")[0];
  return Promise.all([`400 1em ${fam(E)}`, `600 1em ${fam(E)}`, `400 1em ${fam(O)}`, `600 1em ${fam(O)}`]
    .map(f => document.fonts.load(f).catch(() => null)));
}
