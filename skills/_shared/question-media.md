# Pictures and mockups in a question's answer

When a picture answers better than words, or the user asks for a sketch, put
it in the answer itself. Never publish it anywhere else, such as a claude.ai
Artifact or a gist.

- **Screenshot.** Capture from fictional data with the repository's
  documented capture command (such as in `AGENTS.md` or `CLAUDE.md`) into a
  scratch folder.
- **Mockup.** Draft it in a scratch folder with
  `orc-mockup-scaffold --dir <scratch> --label <label>-mockup` (Orc's tokens
  and fonts; other projects use their own), then take its picture:

  ```bash
  (cd <scratch> && exec python3 -m http.server 47611 --bind 127.0.0.1) & server=$!
  orc-agent-browser open <run-id> http://127.0.0.1:47611/<label>-mockup.html
  orc-agent-browser viewport <run-id> <width> <height>
  orc-agent-browser screenshot <run-id> --name <label>-mockup.png
  orc-agent-browser close <run-id>
  kill $server
  mv <run-dir>/browser/screenshots/<label>-mockup.png <scratch>/
  ```

  Never write into the run's `shots/`: a question run holding it is no
  longer an answer, and `--update` refuses it.

Pass each file to `orc-publish-question` with `--media <file>` (repeat it),
on first publication or a follow-up's `--update`; it copies it to
`media/<name>`, a mockup with the `fonts/` it names. In `answer.md`, show the
screen today and the mockup's picture (named `<label>-mockup.<ext>`) on two
adjacent lines, so Orc sets them side by side as Today and Mockup, then link the mockup:

```markdown
![The composer today](media/composer-today.jpg)
![Mockup of the composer with Start without a plan](media/composer-mockup.png)

[Open in browser](media/composer-mockup.html)
```

A lone picture is one image line. The helper refuses an answer that names a
`media/` file it was not given.
