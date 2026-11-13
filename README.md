# Playing Against Chance

A game-of-life installation by H (M.Des New Media, NID). One physical die, random.org, a painted
avatar from the camera, and worlds generated from each life event.

- `bookkeeper/`   the first experiments: the Bookkeeper lottery and its voice bench
- `prototypes/`   the standalone browser stages (birth, where, love, genes, exam, career, ... later)
- `chance-proto/` the first image-generation test
- `stream-proto/` the live game: server (`stream_server.py`), pages (`web/`), dice reader, cloud scripts
- `docs/`         the storyline and the life trajectory the game is built from

See `stream-proto/README.md` to run it. Every saved version is a commit, oldest first.

## The random.org key

The key is not in the repository. On the Mac, put it in `stream-proto/random_org.key` (one line, nothing else).
`push.sh` sends it to the cloud machine; git ignores it. Without it the game uses the computer's own randomness.
