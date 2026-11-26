# Event sound clips

Settings → Sounds offers these bundled clips for every run event. Orc serves
them locally from the catalog in `ui/js/sound.js`. The fanfare has its
own note, `ui/ready-fanfare-source.md`.
Sound files people add themselves in Settings are not here: Orc keeps
them in `~/.orc/sounds/` (`ui/custom_sounds.py`).

## Original synthesized clips

Original notes and timbres rendered offline. Each MP3 is mono, 44.1 kHz and
96 kbps.

| Clip | Name in Settings | Sound |
|---|---|---|
| `wooden-double-tap.mp3` | Wooden double tap | Two dry knocks, the second pitched higher |
| `glass-chime.mp3` | Glass chime | Two bright notes with overlapping glass overtones |
| `home-chord.mp3` | Home chord | Two soft plucks resolving into a major chord |
| `reed-call.mp3` | Reed call | A rising pair of mellow reed notes |
| `thumb-piano.mp3` | Thumb piano | Three descending plucked tines |
| `sonar-ping.mp3` | Sonar ping | A high rounded ping with two fading echoes |
| `pocket-drum.mp3` | Pocket drum | Two quick rim taps and a lower drum hit |
| `silver-string.mp3` | Silver string | A brushed open fifth with a bright final pluck |
| `clockwork.mp3` | Clockwork | Three short metallic ticks with a pause before the last |
| `steam-whistle.mp3` | Steam whistle | Two high whistle notes swelling together |
| `bass-bloom.mp3` | Bass bloom | Two rounded bass notes rising a fifth |

## Generated sound effects

| Clip | Name in Settings | Prompt |
|---|---|---|
| `level-up.mp3` | Level up | Retro 8-bit video game level-up jingle, bright rising chiptune arpeggio, short and cheerful |
| `ta-da.mp3` | Ta-da | Short triumphant brass ta-da fanfare sting, two notes, cartoon reveal |
| `ka-ching.mp3` | Ka-ching | Old cash register ka-ching, a bell ding and the drawer sliding open |
| `war-horn.mp3` | War horn | Deep orcish war horn, one short bold blast echoing across a valley |
| `kazoo.mp3` | Kazoo | Tiny silly kazoo fanfare, four quick notes, comedic |
| `sparkle.mp3` | Sparkle | Magical sparkle chime, twinkling fairy dust glissando, soft and bright |
| `bubble-pop.mp3` | Bubble pop | Single cartoon bubble pop, a soft bloop, clean and short |

### Encoding

`<id>.mp3`: mono, 44.1 kHz, 96 kbps, silence trimmed from both ends.
Each is raised or lowered towards -13 LUFS, the level of the fanfare, behind a
limiter at -2 dBFS that takes at most 3 dB off a peak. A short sharp sound such
as the pop or the bell therefore measures quieter than the longer ones.
