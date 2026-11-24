# Ready fanfare clip

`ready-fanfare.wav` is `jingles_STEEL00.ogg`, a short steel-drum chime, from
Kenney's [Music Jingles](https://kenney.nl/assets/music-jingles) pack, downloaded on
2026-11-01. The pack is released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), so the clip
needs no attribution and can be redistributed with Orc.

Source SHA-256: `8799eb726d784ae0aa1a9df80648a873ac60015bc00aea12c8e2dd1431a2bd7d`.

It plays when a run becomes ready to ship and from Settings' **Play test
sound**, subject to Orc's sound setting. It is stereo 44.1 kHz PCM with 2 dB added
gain. The timing and pitch are unchanged.

To reproduce from the pack's OGG:

```sh
ffmpeg -i jingles_STEEL00.ogg -ar 44100 -af 'volume=2dB' \
  -map_metadata -1 -c:a pcm_s16le ready-fanfare.wav
```
