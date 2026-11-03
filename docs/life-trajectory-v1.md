# Playing Against Chance: Life Trajectory v1

3 Nov 2026 · H

## How it works

One life, the same 19 events for every player, from birth to death. The tone is satirical throughout.

**Two sources of chance**

- **The die:** one physical six-sided die, thrown by the player. It is used only in Chosen events.
- **random.org:** never seen by the player. It decides everything the die doesn't: what you're allotted after a missed throw, and how every Happen and Fluke event turns out.

**Three types of event**

| Type | Who decides | What happens |
| --- | --- | --- |
| Chosen | The player, then the die | The player picks an option and throws for it. |
| Happens | random.org | Each Happen event has three hidden outcomes: good, bad and neutral. random.org picks one. |
| Fluke | random.org | Something tiny and ordinary happens. It means nothing now and changes a later Happen event, where the system reveals the link. |

**The rule for every Chosen event**

1. The player picks an option.
2. The system locks it and shows the target, for example "3 or more" or "exactly 6".
3. The player throws the die once.
4. Hit: the player gets the option they chose.
5. Miss: random.org allots one of that event's options instead, and the life moves on.

Rarer options have harder targets. On one die, targets run from easiest to hardest: 2 or more, 3 or more, 4 or more, 5 or more, then a single number ("a 6", "exactly 1").

**Two exceptions, both from your draft**

- **Birth** gives three throws instead of one. After the third miss, the override applies and random.org allots the gender.
- **Love** has no allotment. A miss means you didn't find love that day, and the life moves on.

**Happen events**

The three outcomes of each Happen event are written in advance (hardcoded). random.org picks one with equal odds. The player never sees the three possibilities, only the one that happened.

**Flukes**

There are two flukes. The first decides how your first job finds you. The second is planted quietly at 52 and pays off at retirement, in a Happen event that reveals the link ("Because you lent a stranger your umbrella at 52…").

## On screen

**The player sees**

- the event's name and one line of setup
- the options, as cards
- the target for the option they locked
- the die result, then what happened

**The player never sees**

- percentages, odds or forecasts as numbers
- the three possible outcomes of a Happen event
- that a fluke mattered, until the system reveals it later

**Options as cards, not buttons**

- Small, minimal plaque cards sit in a row at the bottom of the screen.
- Resting, a card shows only the option's name. Hovered or approached, it moves slightly and reveals its one-line description.
- When the player picks one, the system locks that card, sets the others aside, and shows the challenge: the target to throw.

**Look**

- Very minimal and clean.
- A clean typeface.
- Translucent, soft windows for text instead of hard boxes.

**Generation**

- Style: paint, for both the avatar and the world.
- At birth the avatar is a baby, not a grown adult. It ages as the life moves through the events.

## The unfolding

The life should feel lived, not clicked through. Every event flows out of the one before, and the player always gets time to look, play and breathe. A full life runs about 12–15 minutes.

**No hard cuts**

- Every change is a slow crossfade or morph. The world paints into the next scene over 2–3 seconds; the avatar ages continuously, never in jumps.
- Each new world scene grows out of the previous one (generated from it, plus what just happened), so places change over a life instead of jumping.
- One thing on screen at a time. The previous text fades out fully before the next appears. Nothing stacks.
- Between events, a bridge line (below) carries the time that passes, and the age quietly counts up.

**The beats of a Chosen event**

| Beat | What happens | Time |
| --- | --- | --- |
| Arrive | The bridge line fades in, the age counts up, the world morphs, the avatar ages. | 4–5 s |
| Settle | The event's name and setup line appear in a soft window. Nothing else yet. | at least 3 s |
| Cards | The cards rise one by one at the bottom. They wait as long as the player wants. | player's pace |
| Lock | The chosen card glides to the centre, the others sink away. A beat, then the target appears. | 1–2 s |
| Throw | The screen waits for the die. While it rolls, everything holds still. | player's pace |
| Land | The number shows large, alone, for a moment. Then hit or miss. | 2 s |
| Miss | A pause, then the allotted card turns over slowly. | 2–3 s |
| Linger | What happened stays on screen while the new world paints in. Nothing to do: the player can move and watch the avatar. | 6–8 s |

**Happens and Flukes**

- **Happens:** no input. A short hold ("Something happens."), then the outcome, then a longer linger than a choice, around 8 s.
- **Flukes:** deliberately understated. Small text, a short hold, no emphasis, so it feels like nothing. Its reveal later is the opposite: slow, quoting the original line back word for word.

**Chapters**

Between the phases (after Whom, after the exams, after Settling down) the screen holds a longer breath, about 8–10 s: the world fully repaints and the age runs on. After Death, a final silence of 10 s before anything else.

**All timings are tunable** on the control panel, and stored with the trajectory, so the pace can be adjusted without touching code.

**Bridge lines**

| Between | Line |
| --- | --- |
| 1 → 2 | The nurse writes it down. Somewhere, a map unfolds. |
| 2 → 3 | The place is decided. Now, whose house. |
| 3 → 4 | You learn to walk, then to wait. Eight years pass. |
| 4 → 5 | School, homework, school. Eight more years. |
| 5 → 6 | Two years of studying for one week of exams. |
| 6 → 7 | The marksheet is framed, or hidden. You're twenty, and someone asks what you want to be. |
| 7 → 8 | You hold on to the dream for two years. Then the world does something. |
| 8 → 9 | You need work. Work, it turns out, needs a coincidence. |
| 9 → 10 | Four years at the job. Then one ordinary day. |
| 10 → 11 | Five years pass. A phone call on a Tuesday. |
| 11 → 12 | You live with the choice for three years. |
| 12 → 13 | The relatives start asking at every wedding. |
| 13 → 14 | Four years in, the house finds its routine. |
| 14 → 15 | Eight quiet years. Too quiet. |
| 15 → 16 | You learn to live with it. One evening, it rains. |
| 16 → 17 | Eight more years. The office orders a cake. |
| 17 → 18 | Four years into the rest of it, something comes back. |
| 18 → 19 | The years get shorter. Then there is one left. |
| after 19 | That was a life. |

## The trajectory

Each Chosen event lists its cards: the name the card shows, the line it reveals on hover, and the target the player sees once it's locked. Ages are approximate, for the avatar's growth.

### 1. Birth · Chosen · age 0

Before anything else, the form needs a box ticked. Three throws, then the override.

| Card | Reveals | Target |
| --- | --- | --- |
| Boy | Sweets are handed out. | 3 or more |
| Girl | Sweets are handed out, eventually. | 3 or more |
| Non-binary | The form has two boxes. You'll have to insist. | a 6 |

### 2. Where · Chosen · age 0

Somewhere on the map, a cot is waiting.

| Card | Reveals | Target |
| --- | --- | --- |
| Sub-Saharan Africa | The youngest region on earth. Everyone is your age. | 2 or more |
| South Asia | A fifth of humanity, and all of them have an opinion about your name. | 2 or more |
| East Asia | A billion and a half people, very few of them siblings. | 3 or more |
| Southeast Asia and the Pacific | Thousands of islands. The nearest hospital is on another one. | 4 or more |
| Middle East and North Africa | Oil under the ground, history on top of it. | 4 or more |
| Latin America | Between two oceans, and always between two currencies. | 5 or more |
| Europe | Free healthcare, expensive everything else. | a 6 |
| North America | The passport everyone else queues for. | a 6 |

### 3. Whom · Chosen · age 0

The household decides most of what comes next, and you don't get a vote.

| Card | Reveals | Target |
| --- | --- | --- |
| Landless farmers | Five children, one field, someone else's. | 2 or more |
| A shopkeeper's family | You live above the shop and work in it by seven. | 3 or more |
| Salaried, on loans | A loan for the flat, the car and the fridge. | 3 or more |
| Devout and strict | Prayers before breakfast. Questions, never. | 4 or more |
| Artists, rent overdue | Love, books, and a landlord at the door. | 5 or more |
| Old money | Everything is paid for, including the silence. | a 6 |
| A politician's family | Your birthday is a public event. | exactly 1 |

### 4. The school year · Happens · age 8

| Outcome | What happens |
| --- | --- |
| Good | A teacher notices you and pins your drawing on the wall. She keeps it for years. |
| Bad | The family moves in the middle of the year. New school, new accent, nobody saves you a seat. |
| Neutral | A year passes. You learn long division and forget it by summer. |

### 5. Education · Chosen · age 16

Choose a stream at sixteen, as if you knew who you'd be at forty.

| Card | Reveals | Target |
| --- | --- | --- |
| Arts | There's always room. The relatives will ask what you'll do with it. | 2 or more |
| Commerce | Accounts, and a reasonable future. | 3 or more |
| Science | The default for anyone whose parents worry. | 4 or more |
| Engineering | Two years in a coaching town for a rank and a seat. | 5 or more |
| The medical seat | One for the whole district. | a 6 |
| Drop out, start a channel | Four followers, all family. | exactly 1 |

### 6. The exams · Happens · age 18

| Outcome | What happens |
| --- | --- |
| Good | The paper leaks. The exam is held again, and the retest is easier. |
| Bad | You fall ill in exam week. You pass, barely, and the marksheet follows you for years. |
| Neutral | You make a friend who will call only when they need something, for the next forty years. |

### 7. The dream · Chosen · age 20

Who do you dream of becoming?

| Card | Reveals | Target |
| --- | --- | --- |
| A doctor, as planned | Everyone else's dream, now yours. | 2 or more |
| Rich, honestly | No poetry about it. | 3 or more |
| Someone who leaves | Anywhere but here. | 3 or more |
| An artist | Poor, but interesting at dinner. | 4 or more |
| Someone people remember | A statue, or at least a plaque. | 5 or more |
| Left alone | The rarest thing on the list. | a 6 |

### 8. The black swan · Happens · age 22

| Outcome | What happens |
| --- | --- |
| Good | A technology nobody saw coming arrives. It happens to need exactly what you know. |
| Bad | A pandemic closes the world for two years. Your plans wait in a drawer. |
| Neutral | The stock market crashes. You own no stocks. |

### 9. The first job · Fluke · age 23

random.org picks which small thing finds you work. The system reveals it as it happens.

| Fluke | The job it leads to |
| --- | --- |
| A stranger messages you online after misreading your profile. They like what they misread. | A job at a company you've never heard of. |
| Your old school teacher spots you at a tea stall. Her nephew needs someone. | A job at the nephew's firm. |
| A wrong-number call. The caller was hiring. | A job taken over the phone before either of you noticed the mistake. |

### 10. Love · Chosen · age 27

One day. Somewhere in the city is the love of your life. You meet only if you end up in the same place. A miss means you didn't find love that day, and the life moves on.

| Card | Reveals | Target |
| --- | --- | --- |
| A friend's wedding | Everyone is single there, briefly. | 3 or more |
| The metro at rush hour | Forty minutes pressed against strangers. | 4 or more |
| A dating app | Four hundred matches, none of them where you are. | 5 or more |
| The library | Very quiet. Nobody speaks to anyone. | a 6 |
| Stay home | They'll have to come to you. | exactly 1 |

### 11. The pivot · Chosen · age 32

A chance to change the direction of your life. It expires on Friday.

| Card | Reveals | Target |
| --- | --- | --- |
| Change nothing | The safest bet, and still a bet. | 2 or more |
| Move to the big city | Smaller flat, bigger rent, better story. | 3 or more |
| A friend's business proposal | He has a deck, and an uncle with money. | 4 or more |
| The offer abroad | A new country, and a name nobody there can say. | 5 or more |
| Quit and start the thing | The thing you've described at every party for ten years. | a 6 |

### 12. The years after · Happens · age 35

| Outcome | What happens |
| --- | --- |
| Good | A senior colleague retires early. Their work, and their office, become yours. |
| Bad | Your company is sold. Your role is "under review" for three years. |
| Neutral | You get a new chair. You talk about it for a week. |

### 13. Marriage · Chosen · age 36

Who do you want to spend your life with?

| Card | Reveals | Target |
| --- | --- | --- |
| Whoever the family finds | There is already a shortlist. | 2 or more |
| Someone from the same background | The relatives approve before they meet them. | 3 or more |
| No one: marry your work | Your laptop never forgets an anniversary. | 3 or more |
| Someone who makes you laugh | Funny at dinner, funny at 3 a.m. | 4 or more |
| Someone rich | Love can come later. It has a budget. | 5 or more |
| Someone who lets you be | Rarer than rich. | a 6 |

### 14. Settling down · Happens · age 40

| Outcome | What happens |
| --- | --- |
| Good | The relatives move to another city. |
| Bad | The relatives move in. |
| Neutral | Life settles into a routine so steady you stop noticing the years. |

### 15. The buried layer · Chosen · age 48

Something true about your life has been hidden all along. Now it comes out. Choose which. The milder the truth, the rarer it is, so the harder the throw.

| Card | Reveals | Target |
| --- | --- | --- |
| A financial scam | The savings were never there. | 2 or more |
| A rare disease | Slow, and manageable, with a name nobody can pronounce. | 3 or more |
| Swapped at birth | Your real family lives two streets away. | 4 or more |
| The degree | Your university never existed. | 4 or more |
| A half-sibling | They're at the door, with your nose. | 5 or more |
| A small debt | Your father owed a neighbour 400 rupees. | a 6 |
| Nothing | There was no secret. | exactly 1 |

### 16. The umbrella · Fluke · age 52

On a rainy evening, you lend your umbrella to a stranger at a bus stop. You never see it again. Nothing else happens now.

### 17. Retirement · Chosen · age 60

The office gives you a cake and a shawl. What will you mostly do now?

| Card | Reveals | Target |
| --- | --- | --- |
| Mind the grandchildren | Unpaid, full-time, no leave. | 2 or more |
| Go back to where you were born | It's a mall now. | 3 or more |
| Write the memoir | Chapter one is 200 pages. | 4 or more |
| See the world | Seven countries in twelve days, on a bus. | 5 or more |
| Start a business, at last | Your children are investors, reluctantly. | a 6 |
| Forward messages to everyone you know | Good morning, with a sunflower. | exactly 1 |

### 18. The umbrella comes back · Happens · age 64

The system reveals the fluke first: "At 52, you lent a stranger your umbrella." Then random.org picks the outcome.

| Outcome | What happens |
| --- | --- |
| Good | The stranger became a minister. He remembers the umbrella. Your pension file moves to the top of the pile. |
| Bad | The umbrella, your name sewn inside, turns up as evidence in someone else's court case. You spend a year explaining you only lent it. |
| Neutral | You see the same umbrella in a shop window, for sale. You don't buy it back. |

### 19. Death · Chosen · the end

You get to choose how you go. Mostly.

| Card | Reveals | Target |
| --- | --- | --- |
| Of something with a long name | The doctors are excited. You are less so. | 2 or more |
| On the day the pension arrives | The money clears. You don't. | 3 or more |
| Laughing at your own joke | Nobody else laughed. | 4 or more |
| Mid-sentence, finally winning an argument | The last word was yours. Half of it. | 5 or more |
| In your sleep, at 94 | Everyone's first choice. | a 6 |
| A laddoo at a wedding | Very festive. | exactly 1 |

## The life at a glance

| # | Event | Type | Age |
| --- | --- | --- | --- |
| 1 | Birth | Chosen, 3 throws | 0 |
| 2 | Where | Chosen | 0 |
| 3 | Whom | Chosen | 0 |
| 4 | The school year | Happens | 8 |
| 5 | Education | Chosen | 16 |
| 6 | The exams | Happens | 18 |
| 7 | The dream | Chosen | 20 |
| 8 | The black swan | Happens | 22 |
| 9 | The first job | Fluke, revealed now | 23 |
| 10 | Love | Chosen, a miss means no love | 27 |
| 11 | The pivot | Chosen | 32 |
| 12 | The years after | Happens | 35 |
| 13 | Marriage | Chosen | 36 |
| 14 | Settling down | Happens | 40 |
| 15 | The buried layer | Chosen | 48 |
| 16 | The umbrella | Fluke, planted | 52 |
| 17 | Retirement | Chosen | 60 |
| 18 | The umbrella comes back | Happens, reveals the fluke | 64 |
| 19 | Death | Chosen | end |
