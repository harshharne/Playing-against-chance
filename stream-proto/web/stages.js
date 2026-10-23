// ============================================================================
//  THE TRAJECTORIES — edit this file to change what chance can hand out.
//  Every option has a weight ("w"): its odds are w out of the total of its list.
//  "short" (optional) is the text on its button; otherwise "label" is used.
//  In every round the player picks what they WISH for, then chance draws what they GET.
//  Prompt fragments ("p", "bg", "clothes", ...) are glued into the image prompts below.
//  Nothing else needs to change when you add, remove or reword options.
// ============================================================================

// added to every prompt, so all stages share one look (a STYLE reference in the lab also carries over)
export const STYLE = "storybook illustration, soft painterly colours, gentle light";

// ---------- 1. BIRTH ----------  (drawn, no generation)
// You pick one of the sperm, the dice decides which one reaches the egg.
export const BIRTH = {
  sperm: 6,
  intro: "Pick your sperm. Chance picks the one that makes it.",
  won: "That was you. You're born.",
  lost: (n) => `Sperm ${n} made it. Someone else was born. Not you.`,
};

// ---------- 2. BODY ----------
// One draw per trait. Rough real-world shares where they're known; edit freely.
export const BODY = {
  intro: "Wish for each trait. Chance decides.",
  strength: 0.8,                       // babies need a big change from a grown-up camera image
  bg: "a soft warm hospital nursery, blurred, morning light through curtains",
  traits: [
    { key: "sex", name: "SEX", options: [
      { label: "GIRL", w: 49, baby: "baby girl", child: "girl", adult: "young woman" },
      { label: "BOY", w: 51, baby: "baby boy", child: "boy", adult: "young man" },
    ] },
    { key: "hair", name: "HAIR", options: [
      { label: "BLACK", w: 75, p: "black" },
      { label: "BROWN", w: 16, p: "brown" },
      { label: "BLONDE", w: 7, p: "blonde" },
      { label: "RED", w: 2, p: "red" },
    ] },
    { key: "curl", name: "HAIR TYPE", options: [
      { label: "STRAIGHT", w: 45, p: "straight" },
      { label: "WAVY", w: 30, p: "wavy" },
      { label: "CURLY", w: 25, p: "curly" },
    ] },
    { key: "eyes", name: "EYES", options: [
      { label: "BROWN", w: 79, p: "brown" },
      { label: "HAZEL", w: 6, p: "hazel" },
      { label: "BLUE", w: 9, p: "blue" },
      { label: "GREEN", w: 2, p: "green" },
      { label: "GREY", w: 4, p: "grey" },
    ] },
    { key: "build", name: "BUILD", options: [
      { label: "SMALL", w: 30, p: "small and slight" },
      { label: "AVERAGE", w: 45, p: "average build" },
      { label: "TALL", w: 25, p: "tall" },
    ] },
  ],
};

// ---------- 3. HOME ----------
export const HOME = {
  intro: "Which family do you wish for?",
  strength: 0.75,
  options: [
    { label: "A WEALTHY CITY FAMILY", short: "WEALTHY", w: 5, privileges: ["private school", "a car", "no money worries"],
      clothes: "neat expensive clothes", bg: "a spacious modern apartment, big windows, city skyline" },
    { label: "A MIDDLE-CLASS FAMILY", short: "MIDDLE-CLASS", w: 20, privileges: ["school every day", "a doctor when sick"],
      clothes: "a school uniform", bg: "a small tidy city flat, family photos on the wall" },
    { label: "A WORKING-CLASS FAMILY", short: "WORKING-CLASS", w: 25, privileges: ["one income", "a shared room"],
      clothes: "simple hand-me-down clothes", bg: "a crowded two-room home in a dense city neighbourhood" },
    { label: "A FARMING FAMILY", short: "FARMING", w: 25, privileges: ["fields to work", "a village school"],
      clothes: "simple cotton clothes, barefoot", bg: "a mud-walled village house surrounded by green fields" },
    { label: "A FAMILY IN AN INFORMAL SETTLEMENT", short: "INFORMAL SETTLEMENT", w: 15, privileges: ["no running water", "working young"],
      clothes: "worn, patched clothes", bg: "a tin-roofed home in a dense informal settlement" },
    { label: "A SINGLE PARENT", short: "SINGLE PARENT", w: 10, privileges: ["one tired parent", "a lot of love, little time"],
      clothes: "an oversized hoodie", bg: "a small rented room, warm lamp light in the evening" },
  ],
};

// ---------- 4. WORLD ----------  (where, then when)
// Region weights: where babies are actually born (UN, 2023). The city is then an even pick inside the region.
export const WORLD = {
  intro: "Where on Earth do you wish to be born?",
  introWhen: "And when?",
  strength: 0.7,
  where: [
    { label: "SUB-SAHARAN AFRICA", w: 31, cities: ["Lagos", "Nairobi", "Kinshasa"] },
    { label: "SOUTH & CENTRAL ASIA", w: 29, cities: ["Mumbai", "Dhaka", "Karachi"] },
    { label: "EAST ASIA & PACIFIC", w: 16, cities: ["Shanghai", "Jakarta", "Manila"] },
    { label: "MIDDLE EAST & NORTH AFRICA", short: "MIDDLE EAST & N. AFRICA", w: 9, cities: ["Cairo", "Tehran", "Istanbul"] },
    { label: "LATIN AMERICA", w: 7, cities: ["São Paulo", "Mexico City", "Lima"] },
    { label: "EUROPE & NORTH AMERICA", w: 8, cities: ["London", "New York", "Berlin"] },
  ],
  when: [
    { label: "THE 1950s", short: "1950s", w: 1, look: "1950s, vintage cars and hand-painted signs", clothes: "1950s clothes" },
    { label: "THE 1970s", short: "1970s", w: 1, look: "1970s, faded colours, old buses", clothes: "1970s clothes" },
    { label: "THE 1990s", short: "1990s", w: 1, look: "1990s, crowded street, satellite dishes", clothes: "1990s clothes" },
    { label: "THE 2010s", short: "2010s", w: 1, look: "2010s, smartphones, traffic, billboards", clothes: "2010s clothes" },
    { label: "THE 2040s", short: "2040s", w: 1, look: "2040s, near future, solar panels, heat haze", clothes: "near-future clothes" },
  ],
};

// ---------- the prompts, built from what chance gave you ----------
// r = the results so far: r.body.sex, r.body.hair ... , r.home, r.world.where, r.world.city, r.world.when
export const PROMPTS = {
  body: (r) => ({
    person: `a newborn ${r.body.sex.baby}, ${r.body.hair.p} ${r.body.curl.p} hair, ${r.body.eyes.p} eyes, wrapped in a soft blanket, ${STYLE}`,
    background: `${BODY.bg}, ${STYLE}`,
  }),
  home: (r) => ({
    person: `a seven-year-old ${r.body.sex.child}, ${r.body.hair.p} ${r.body.curl.p} hair, ${r.body.eyes.p} eyes, wearing ${r.home.clothes}, ${STYLE}`,
    background: `${r.home.bg}, wide shot, ${STYLE}`,
  }),
  world: (r) => ({
    person: `a ${r.body.build.p} ${r.body.sex.adult}, ${r.body.hair.p} ${r.body.curl.p} hair, ${r.body.eyes.p} eyes, wearing ${r.world.when.clothes}, ${STYLE}`,
    background: `a street in ${r.world.city}, ${r.world.when.look}, wide shot, ${STYLE}`,
  }),
};
