// ============================================================================
//  THE STORYLINE (stage one, v2, one die): one hardcoded life, the same moments for every player.
//  Chance decides how each one goes. Edit the words here; the rules live in game.html.
//
//  Three kinds of moment
//    default  happens to you. random.org rolls a d6 on the moment's table; the player watches.
//    choice   the player picks an option (each shows its target), then rolls the die.
//    fluke    something small. random.org rolls a d6: 1–5 nothing, 6 leaves a hidden MARK.
//
//  Targets:  { target: 5 } = "5 or more" (6 = "a 6"),  { exact: 3 } = "exactly 3".
//  Modifiers ("mods") move a target one step: +1 = harder, -1 = easier. Exact targets never move.
//    mods: [{ at: "stream", opts: ["science", "medical"], step: +1 }]    opts "*" = every option there
//  Options or entries with needs: "RADIO" only exist when that mark is held; ifSpouse: true only if married.
//  "past" is the same outcome in the third person, for the ending ({she} {her} {hers} {She} {Her} filled in);
//  "aim" is how the ending names an option someone went for (default: its button text).
//  An entry's "scene" becomes the world picture (with the place and the year), "wear" dresses the avatar.
//  Never shown to the player: odds, percentages, the marks (until the ending).
// ============================================================================

export const PHASES = ["BASELINE", "CRUST", "ADULTHOOD", "LATER LIFE"];

export const MOMENTS = [
  // ---------------- BASELINE (age 0) ----------------
  { id: "race", phase: 0, age: 0, title: "THE RACE", kind: "default",
    intro: "Six of them race for the egg. The winner decides your body.",
    table: [
      { faces: [1], short: "GIRL · ROBUST · RESTLESS", text: "A girl. Robust, restless.", body: { sex: "girl", build: "robust", temper: "restless" } },
      { faces: [2], short: "BOY · ORDINARY · STEADY", text: "A boy. Ordinary, steady.", body: { sex: "boy", build: "ordinary", temper: "steady" } },
      { faces: [3], short: "GIRL · FRAGILE · DREAMY", text: "A girl. Fragile, dreamy.", body: { sex: "girl", build: "fragile", temper: "dreamy" } },
      { faces: [4], short: "BOY · ROBUST · STUBBORN", text: "A boy. Robust, stubborn.", body: { sex: "boy", build: "robust", temper: "stubborn" } },
      { faces: [5], short: "GIRL · QUICK WITH NUMBERS", text: "A girl. Quick with numbers.", body: { sex: "girl", build: "ordinary", temper: "quick" },
        mods: [{ at: "stream", opts: ["science"], step: -1 }] },
      { faces: [6], short: "BOY · ANXIOUS", text: "A boy. Anxious.", body: { sex: "boy", build: "ordinary", temper: "anxious" }, mark: "HIDDEN" },
    ] },

  { id: "home", phase: 0, age: 0, title: "THE HOME", kind: "default",
    intro: "Whose house you are carried into.",
    table: [
      { faces: [1], short: "SCRAPING BY · ELDEST OF FOUR", text: "Scraping by. The eldest of four.", home: "a home scraping by, the eldest of four", mark: "POOR",
        scene: "a crowded one-room home, four children on a mat, a tin trunk, a single bulb", wear: "worn hand-me-down clothes" },
      { faces: [2, 3], short: "GETTING BY · MIDDLE OF THREE", text: "Getting by. The middle of three.", home: "a home getting by, the middle of three",
        scene: "a modest two-room home, three children, a ceiling fan, school bags by the door" },
      { faces: [4], short: "GETTING BY · ONLY CHILD", text: "Getting by. An only child.", home: "a home getting by, an only child",
        scene: "a small tidy home, one child, a calendar on the wall, a steel cupboard" },
      { faces: [5], short: "COMFORTABLE · YOUNGEST OF TWO", text: "Comfortable. The youngest of two.", home: "a comfortable home, the youngest of two",
        scene: "a comfortable flat, a sofa, a television, two children's school photos" },
      { faces: [6], short: "WEALTHY · A STRAINED HOME", text: "Wealthy. A strained home.", home: "a wealthy, strained home", mark: "RICH",
        scene: "a large house with polished floors, a long dinner table, a tense silence", wear: "neat expensive clothes" },
    ] },

  { id: "world", phase: 0, age: 0, title: "THE WORLD", kind: "default",
    intro: "Where, and when.",
    table: [
      { faces: [1], short: "VILLAGE · BIHAR · 1972", text: "A village in Bihar, 1972.", world: { place: "a village in Bihar", year: 1972 }, scene: "mud houses, paddy fields, a hand pump" },
      { faces: [2], short: "CITY · PUNJAB · 1979", text: "A city in Punjab, 1979.", world: { place: "a city in Punjab", year: 1979 }, scene: "a busy street, cycle rickshaws, painted shop signs" },
      { faces: [3], short: "SMALL TOWN · GUJARAT · 1985", text: "A small town in Gujarat, 1985.", world: { place: "a small town in Gujarat", year: 1985 }, scene: "a bus stand, a temple, scooters, dusty light" },
      { faces: [4], short: "SMALL TOWN · ASSAM · 1991", text: "A small town in Assam, 1991.", world: { place: "a small town in Assam", year: 1991 }, scene: "tea gardens, rain, tin roofs" },
      { faces: [5], short: "CITY · KERALA · 1994", text: "A city in Kerala, 1994.", world: { place: "a city in Kerala", year: 1994 }, scene: "coconut palms, red-tiled roofs, backwaters" },
      { faces: [6], short: "METRO · MAHARASHTRA · 2003", text: "A metro in Maharashtra, 2003.", world: { place: "a metro city in Maharashtra", year: 2003 }, scene: "local trains, high-rises, crowds" },
    ] },

  { id: "registry", phase: 0, age: 0, title: "THE REGISTRY", kind: "fluke",
    intro: "A clerk writes your name down.", six: "He adds a letter.", mark: "NAME",
    scene: "a government registry office, towers of files, a clerk at a desk with a fountain pen" },

  { id: "astrologer", phase: 0, age: 0, title: "THE ASTROLOGER", kind: "default",
    intro: "An astrologer reads your chart. Your parents are told you will become…",
    scene: "an astrologer reading a horoscope chart for a family, an oil lamp, marigolds",
    table: [
      { faces: [1], short: "A DOCTOR", text: "…a doctor.", forecast: "doctor" },
      { faces: [2], short: "AN ENGINEER", text: "…an engineer.", forecast: "engineer" },
      { faces: [3], short: "A GOVERNMENT OFFICER", text: "…a government officer.", forecast: "officer" },
      { faces: [4], short: "SOMEONE WHO GOES ABROAD", text: "…someone who goes abroad.", forecast: "abroad" },
      { faces: [5], short: "SOMEONE WHO MARRIES WELL", text: "…someone who marries well.", forecast: "marries" },
      { faces: [6], short: "FAMOUS", text: "…famous.", forecast: "famous" },
    ] },

  // ---------------- CRUST (0–18) ----------------
  { id: "radio", phase: 1, age: 7, title: "THE RADIO", kind: "fluke",
    intro: "A cousin leaves a broken radio at your house.", six: "You take it apart and put it back together.", mark: "RADIO",
    scene: "a child's corner of a room, a broken transistor radio, a borrowed screwdriver" },

  { id: "family", phase: 1, age: 11, title: "THE FAMILY", kind: "default",
    intro: "At home, this year…",
    table: [
      { faces: [1], short: "A PARENT LOSES THEIR JOB", text: "A parent loses their job.", past: "A parent lost their job.", mods: [{ at: "stream", opts: ["science", "medical"], step: +1 }],
        scene: "a parent sitting alone at the kitchen table, unpaid bills" },
      { faces: [2], short: "THE FAMILY MOVES CITIES", text: "The family moves cities.", past: "The family moved cities.", mods: [{ at: "stream", opts: "*", step: +1 }], move: true,
        scene: "a family loading a truck with bundles and a steel trunk, a new street" },
      { faces: [3], short: "A SIBLING IS BORN", text: "A sibling is born. You mind the baby after school.", past: "A sibling was born; {she} minded the baby after school.", mods: [{ at: "stream", opts: ["medical"], step: +1 }],
        scene: "a child rocking a baby in a cradle, schoolbooks left open" },
      { faces: [4], short: "A GRANDFATHER MOVES IN", text: "A grandfather moves in and reads to you every night.", past: "A grandfather moved in and read to {her} every night.", mods: [{ at: "stream", opts: ["arts"], step: -1 }],
        scene: "a grandfather reading a book aloud by lamplight, a child listening" },
      { faces: [5], short: "AN UNCLE PAYS FOR TUITION", text: "An uncle's shop does well. He pays for tuition.", past: "An uncle's shop did well; he paid for tuition.", mods: [{ at: "stream", opts: ["science", "medical"], step: -1 }],
        scene: "a tuition class, rows of children, a blackboard full of equations" },
      { faces: [6], short: "NOTHING HAPPENS", text: "Nothing happens.", past: "Nothing happened.", scene: "an ordinary afternoon, children playing in the lane" },
    ] },

  { id: "stream", phase: 1, age: 16, title: "THE STREAM", kind: "choice",
    intro: "After the board exams, which stream?",
    options: [
      { id: "medical", short: "THE MEDICAL SEAT", label: "the medical seat: one for the whole district", target: 6, markMods: { RICH: -1 },
        text: "The medical seat is yours.", past: "Got the medical seat.", scene: "a medical college gate, white coats, a dissection hall", wear: "a white coat", became: "a doctor" },
      { id: "science", short: "SCIENCE", label: "science", target: 5, markMods: { POOR: +1 },
        text: "Science.", past: "Got science.", scene: "a school science lab, test tubes, a periodic table on the wall", wear: "a school uniform" },
      { id: "commerce", short: "COMMERCE", label: "commerce", target: 4,
        text: "Commerce.", past: "Got commerce.", scene: "a commerce classroom, ledgers and calculators", wear: "a school uniform" },
      { id: "arts", short: "ARTS", label: "arts: there's always room", target: 2,
        text: "Arts. There's always room.", past: "Got arts.", scene: "a crowded arts college classroom, poetry on the blackboard", wear: "a school uniform" },
      { id: "phones", short: "FIX PHONES IN THE MARKET", aim: "fixing phones in the market", label: "leave school, fix phones in the market", exact: 3, needs: "RADIO",
        text: "You leave school and fix phones in the market.", past: "Left school to fix phones in the market.", scene: "a tiny phone repair stall in a busy market, tangled wires, a soldering iron", wear: "a faded shirt" },
    ],
    allotted: [
      { short: "AGRICULTURAL SCIENCE, ANOTHER DISTRICT", text: "Agricultural science, in another district.", past: "agricultural science, in another district", scene: "an agricultural college in another district, test plots of crops" },
      { short: "A DIPLOMA IN FISHERIES", text: "A diploma in fisheries.", past: "a diploma in fisheries", scene: "a fisheries college by a river, nets drying" },
      { short: "A MANAGEMENT-QUOTA SEAT", text: "A management-quota seat. Paid for.", past: "a management-quota seat, paid for", needs: "RICH", scene: "a private college office, a thick envelope on the desk" },
    ] },

  // ---------------- ADULTHOOD (18–60) ----------------
  { id: "train", phase: 2, age: 19, title: "THE TRAIN", kind: "fluke",
    intro: "You miss a train by ten seconds.", six: "On the platform, you get talking to a stranger.", mark: "PLATFORM",
    scene: "a railway platform, a train pulling away, a tea stall" },

  { id: "economy", phase: 2, age: 23, title: "THE ECONOMY", kind: "default",
    intro: "The year you finish studying…",
    table: [
      { faces: [1, 2], short: "A RECESSION", text: "A recession.", past: "A recession.", mods: [{ at: "offer", opts: "*", step: +1 }], scene: "shuttered shops, newspaper headlines about layoffs" },
      { faces: [3, 4], short: "AN ORDINARY YEAR", text: "An ordinary year.", past: "An ordinary year.", scene: "an ordinary busy street, job notices on a wall" },
      { faces: [5, 6], short: "YOUR FIELD IS IN DEMAND", text: "Your field is suddenly the one everyone wants.", past: "{Her} field was suddenly the one everyone wanted.", mods: [{ at: "offer", opts: "*", step: -1 }], scene: "a job fair, long queues of recruiters, banners" },
    ] },

  { id: "offer", phase: 2, age: 26, title: "THE OFFER", kind: "choice",
    intro: "Work. What do you go for?",
    options: [
      { id: "abroad", short: "ABROAD", aim: "going abroad", label: "abroad: a visa lottery", target: 6,
        text: "The visa comes through. You go abroad.", past: "The visa came through; {she} went abroad.", scene: "an airport departure hall, a suitcase tied with string", wear: "a new jacket", became: "someone who went abroad", job: "abroad" },
      { id: "govt", short: "THE GOVERNMENT EXAM", aim: "the government exam", label: "the government exam: lakhs apply for a few hundred posts", target: 5,
        text: "You clear the exam. A government post.", past: "Cleared the government exam.", scene: "a government office, files tied with red string, a ceiling fan", wear: "a pressed shirt", became: "a government officer", job: "officer" },
      { id: "startup", short: "A FRIEND'S STARTUP", label: "a friend's startup", target: 3,
        text: "You join a friend's startup.", past: "Joined a friend's startup.", scene: "a cramped startup office, laptops, a whiteboard of plans", wear: "a t-shirt and jeans", became: "someone at a friend's startup", job: "startup" },
      { id: "anyjob", short: "ANY JOB THAT PAYS", aim: "any job that paid", label: "any job that pays this month", target: 2,
        text: "Any job that pays this month.", past: "Took any job that paid.", scene: "a busy back office, rows of desks", wear: "a plain office shirt", became: "someone with a job that paid", job: "anyjob" },
      { id: "interview", short: "THE INTERVIEW FOR YOUR NAME", aim: "the interview meant for someone with {her} name, spelled right", label: "the interview meant for someone with your name, spelled right", exact: 1, needs: "NAME",
        text: "You walk into the interview meant for someone else. You get it.", past: "Walked into an interview meant for someone else, and got the job.", scene: "a polished corporate interview room, a nameplate with a different spelling", wear: "a borrowed suit", became: "someone in a job meant for someone else", job: "interview" },
    ],
    allotted: [
      { short: "NIGHT SHIFT AT A CALL CENTRE", text: "The night shift at a call centre.", past: "the night shift at a call centre", scene: "a call centre at night, headsets, rows of glowing screens", wear: "a headset and an ID card", became: "a voice on the night shift at a call centre" },
      { short: "YOUR COUSIN'S SHOP", text: "Your cousin's shop.", past: "a cousin's shop", scene: "a small shop counter, shelves of goods, a cousin at the till", became: "the one minding a cousin's shop" },
      { short: "COACHING CLASSES", text: "Teaching coaching classes for the exam you failed.", past: "teaching coaching classes for the exam {she} failed", scene: "a coaching centre classroom, a blackboard of exam questions", became: "a teacher of the exam that failed them" },
    ] },

  { id: "marriage", phase: 2, age: 31, title: "MARRIAGE", kind: "choice",
    intro: "And marriage?",
    options: [
      { id: "choose", short: "SOMEONE YOU CHOOSE", aim: "someone {she} chose", label: "someone you choose (the family has to agree)", target: 5,
        text: "Someone you chose. The family agrees.", past: "Married someone {she} chose.", scene: "a small happy wedding, marigold garlands", wear: "wedding clothes", spouse: "someone they chose" },
      { id: "family", short: "THE FAMILY'S CHOICE", label: "the family's choice", target: 3,
        text: "The family's choice.", past: "Married the family's choice.", scene: "a big arranged wedding, relatives everywhere", wear: "heavy wedding clothes", spouse: "the family's choice" },
      { id: "none", short: "NO ONE, FOR NOW", label: "no one, for now (the aunts have opinions)", target: 2,
        text: "No one, for now. The aunts have opinions.", past: "No one, for now.", scene: "a family gathering, aunts whispering over tea", spouse: null },
      { id: "stranger", short: "THE STRANGER FROM THE PLATFORM", label: "the stranger from the platform", exact: 4, needs: "PLATFORM",
        text: "The stranger from the platform.", past: "Married the stranger from the platform.", scene: "a quiet registry wedding, two people who met on a railway platform", wear: "simple wedding clothes", spouse: "the stranger from the platform" },
    ],
    allotted: [
      { short: "THE FAMILY'S CHOICE, ANYWAY", text: "The family's choice, anyway.", past: "the family's choice, anyway", scene: "a big arranged wedding, relatives everywhere", wear: "heavy wedding clothes", spouse: "the family's choice, anyway" },
      { short: "A WEDDING CALLED OFF", text: "A wedding, called off a week before.", past: "a wedding, called off a week before", scene: "wedding decorations being taken down, folded chairs", spouse: null },
    ] },

  { id: "typo", phase: 2, age: 38, title: "THE TYPO", kind: "fluke",
    intro: "You send an email to the whole office. There's a typo in it.", six: "Everyone laughs. Someone writes it on the whiteboard.", mark: "TYPO",
    scene: "an open-plan office, a whiteboard, colleagues looking at their screens" },

  { id: "office", phase: 2, age: 45, title: "THE OFFICE", kind: "default",
    intro: "This year at work…",
    table: [
      { faces: [1, 2], short: "RESTRUCTURED OUT", text: "Restructured out.", past: "Restructured out.", work: "out", scene: "an empty desk, a cardboard box of belongings",
        ifMark: { TYPO: { text: "Restructured out… but the typo became the product's name. You're kept on.", past: "Nearly restructured out; the typo had become the product's name, so {she} was kept on.", work: "typo", scene: "a product launch, the old typo printed huge on a banner" } } },
      { faces: [3, 4], short: "NOTHING CHANGES", text: "Nothing changes.", past: "Nothing changed at work.", work: "same", scene: "the same desk, the same window, years of files" },
      { faces: [5], short: "PROMOTED", text: "Promoted.", past: "Promoted.", work: "up", scene: "a bigger office, a nameplate on the door", wear: "a blazer" },
      { faces: [6], short: "THE DESK IS YOURS", text: "Your boss leaves suddenly. The desk is yours.", past: "The boss left suddenly; the desk became {hers}.", work: "boss", scene: "the boss's empty corner office, the chair still turning", wear: "a blazer" },
    ] },

  { id: "buried", phase: 2, age: 47, title: "THE BURIED LAYER", kind: "default",
    intro: "A check-up, a form, an ordinary year…",
    override: (S) => S.marks.has("HIDDEN")
      ? { text: "What the body hid comes up. A condition you were born with surfaces.", past: "A condition {she} was born with surfaced.", health: "surfaced", scene: "a hospital corridor, a doctor holding an x-ray to the light" }
      : S.marks.has("NAME")
        ? { text: "A clerical error declares you dead.", past: "A clerical error declared {her} dead.", health: "dead-on-paper", scene: "a government office, a death certificate with your name, spelled right" }
        : null,
    table: [
      { faces: [1], short: "A SCARE", text: "A scare that turns out to be nothing.", past: "A scare that turned out to be nothing.", scene: "a clinic waiting room, a report in an envelope" },
      { faces: [2, 3, 4, 5], short: "NOTHING, YET", text: "Nothing, yet.", past: "Nothing, yet.", scene: "an ordinary evening at home, tea and the news" },
      { faces: [6], short: "DECLARED DEAD", text: "A clerical error declares you dead.", past: "A clerical error declared {her} dead.", health: "dead-on-paper", scene: "a government office, a death certificate on the desk" },
    ] },

  // ---------------- LATER LIFE (60–end) ----------------
  { id: "later", phase: 3, age: 62, title: "THE TIME LEFT", kind: "choice",
    intro: "With the time left…",
    options: [
      { id: "start", short: "THE THING YOU NEVER DID", aim: "the thing {she} never did", label: "start the thing you never did", target: 5,
        text: "You finally start the thing you never did.", past: "Finally started the thing {she} never did.", scene: "an old person's first art class, easels, morning light", later: "started the thing they never did" },
      { id: "back", short: "BACK TO WHERE YOU WERE BORN", aim: "going back to where {she} was born", label: "go back to where you were born", target: 4,
        text: "You go back to where you were born.", past: "Went back to where {she} was born.", scene: "a homecoming, the old street where it all began", later: "went back to where they were born" },
      { id: "children", short: "NEAR THE CHILDREN", aim: "staying near the children", label: "stay near the children", target: 2,
        text: "You stay near the children.", past: "Stayed near the children.", scene: "a crowded family flat, grandchildren's toys everywhere", later: "stayed near the children" },
      { id: "repair", short: "A REPAIR SHOP, FINALLY", aim: "a repair shop", label: "open a repair shop, finally", exact: 3, needs: "RADIO",
        text: "You open a repair shop, finally.", past: "Opened a repair shop, finally.", scene: "a small repair shop full of old radios, a hand-painted sign", wear: "a work apron", later: "opened a repair shop, finally" },
    ],
    allotted: [
      { short: "THE GRANDCHILDREN DECIDE", text: "The grandchildren arrive and decide for you.", past: "the grandchildren arriving and deciding for {her}", scene: "grandchildren pulling an old person by the hand", later: "let the grandchildren decide" },
      { short: "A PILGRIMAGE, ALREADY BOOKED", ifSpouse: true, text: "A pilgrimage your spouse already booked.", past: "a pilgrimage {her} spouse had already booked", scene: "a pilgrimage, a crowded river ghat, a tour bus", later: "went on a pilgrimage someone else had booked" },
    ] },

  { id: "end", phase: 3, age: null, title: "THE END", kind: "default",
    intro: "And the end comes at…",
    faceShift: (S) => (S.marks.has("HIDDEN") ? -1 : 0),        // HIDDEN: one face lower
    table: [
      { faces: [1], short: "66", text: "66.", endAge: 66 },
      { faces: [2], short: "71", text: "71.", endAge: 71 },
      { faces: [3], short: "74", text: "74.", endAge: 74 },
      { faces: [4], short: "79", text: "79.", endAge: 79 },
      { faces: [5], short: "84", text: "84.", endAge: 84 },
      { faces: [6], short: "93", text: "93.", endAge: 93 },
    ] },
];

// ---------- how the avatar looks at each age ----------
export function avatar(S, age) {
  const b = S.body || {};
  const g = b.sex === "girl", kid = g ? "girl" : "boy", grown = g ? "woman" : "man", their = g ? "her" : "his";
  const who = age === 0 ? `a newborn baby ${kid}, wrapped in a cloth`
    : age < 12 ? `a ${age}-year-old ${kid}`
    : age < 18 ? `a ${age}-year-old teenage ${kid}`
    : age < 30 ? `a young ${grown} in ${their} twenties`
    : age < 42 ? `a ${grown} in ${their} thirties`
    : age < 60 ? `a middle-aged ${grown}, a little grey`
    : age < 70 ? `a ${grown} in ${their} sixties, grey hair`
    : `a very old ${grown}, white hair, frail`;
  const build = { robust: "sturdy build", fragile: "slight, delicate build" }[b.build] || "";
  const look = { restless: "restless energy", steady: "a calm steady gaze", dreamy: "dreamy faraway eyes", stubborn: "a stubborn set jaw",
                 quick: "sharp curious eyes", anxious: "anxious eyes" }[b.temper] || "";
  const decade = S.world ? `${Math.floor((S.world.year + age) / 10) * 10}s` : "";
  const wear = age === 0 ? "" : `wearing ${S.wear || (decade ? `everyday Indian clothes of the ${decade}` : "everyday clothes")}`;
  return [who, build, look, wear].filter(Boolean).join(", ");
}

// ---------- the world picture: the outcome's scene + the place + the year ----------
export function worldScene(S, age) {
  const parts = [S.scene || "a quiet room"];
  if (S.world) parts.push(`${S.place || S.world.place}, India`, `the year ${S.world.year + age}`);
  return parts.join(", ");
}
