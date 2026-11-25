# Tests

One command, on the Mac or anywhere with Python 3 and Node. No GPU, no keys, no internet needed for the tests
themselves: the server runs as a stand-in (MOCK mode) from a temporary copy of stream-proto, on its own port, so
your files and the tunnel (8766) are never touched.

    bash tests/run.sh          # the quick set, ~6 min
    bash tests/run.sh full     # + the soak: 6 lives back to back in one page, ~15 min more (LIVES=10 for more)
    bash tests/run.sh life     # one test: files | clock | face | voice | face | the avatar's steadying (animate.Steady) on made-up tracker data: a slipped frame is held, a huge expression eases off, a neutral caught mid-word drifts back, ordinary movement passes (needs torch: skipped on the Mac) |
| voice | the Bookkeeper with a fake OpenAI session: one line at a time, nothing cut, the next moment waits for the line before, a stale comment on the cards is dropped, the room's noise gets no reply, a card named during the cards is picked silently, PAUSE still stops it |
| life | drills | panel | live | whom | soak
| whom | a life of Where, Whom, the baby: Whom is painted by the picture model (no drawing), with no avatar yet, and the screen never blank |

The first run installs Playwright and its Chromium (~150 MB, into tests/node_modules). The stand-in needs
`python3 -m pip install fastapi "uvicorn[standard]" pillow numpy`.

| test | what it checks |
|---|---|
| files | every Python file compiles; every JSON parses; trajectory.json has what the code needs (heritage on every Where card, objects/people, shot gaps); the director's schema is strict |
| clock | the ever-changing world's clock with a fake painter: rhythm, still while paused / the die / a change, a failing painter, no repeats, the same seed rolls the same |
| life | a short life played like a visitor (Body, school, exams, a fluke, death): no errors, never blank, the world keeps changing, the portrait (a bust) stands in the middle, the next life waits for the die |
| drills | the server killed mid-life and started again; pause; world rules switched mid-life; NEW LIFE |
| panel | the panel and the other pages load with no errors; its switches reach the server |
| live | every switch and slider that changes the game at once is moved on the panel while a game plays, and the game page itself is checked (within ~1 s); the mic and the waiting go to a running voice session (OpenAI faked); after a reload the game keeps them. `SLOW=15` acts like a slow GPU |
| soak | lives back to back in one page (as on a show day): memory, WebGL textures, page elements, frame rate after each life; fails if anything keeps growing |

What they can't test: the real GPU (painter, animator), MediaPipe (the cut-out loads from the
internet), the voice (OpenAI), random.org, the die reader, and
how anything looks. Run them before pushing to the GPU machine and before a show.

The short life is made from trajectory.json by tests/lib/short_life.py (Body, school, exams, the umbrella, death).
