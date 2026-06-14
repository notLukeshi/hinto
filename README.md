# Hinto

Hinto is a Chrome MV3 companion extension for selected Marugoto A2 practice pages.
It opens as its own extension window and controls the active Marugoto tab only after
the user confirms an action.

Hinto is not affiliated with, endorsed by, or sponsored by Marugoto, the Japan
Foundation, or any related organization.

## Build

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension from `chrome://extensions`.

## Supported Pages

- `https://a2.marugotoweb.jp/en/vocabulary/text/?topic=5&category=22`
- `https://a2.marugotoweb.jp/en/vocabulary/voice/?topic=5&category=22`
- `https://a2.marugotoweb.jp/en/grammar/lesson9/practice0.html`
- `https://a2.marugotoweb.jp/en/kanji/read/?topic=5&lesson=9`
- `https://a2.marugotoweb.jp/en/kanji/find/?topic=5&lesson=9`

The content script is written to generalize within the same Marugoto URL families,
but these are the inspected and targeted starting pages.

## Permissions

Hinto is intentionally scoped to `https://a2.marugotoweb.jp/*`.

- `activeTab`: lets the extension interact with the current Marugoto exercise after
  the user opens or confirms Hinto.
- `tabs`: lets the standalone Hinto window keep sending commands to the selected
  Marugoto tab even after browser focus moves to the Hinto window.

The extension does not use a remote backend and does not send Hinto analytics or
user exercise data to a third-party service.

## Modes

- Manual hint: highlights the best detected answer on the current page.
- Auto run: clicks answers only after explicit confirmation from the Hinto window.
  It stops when it reaches a score/end screen, loses confidence, or the user presses
  Stop.

## Known Issues / Limitations

- Vocabulary voice exercises are still experimental and can fail to detect a usable
  answer on some pages.
- Vocabulary text exercises can still produce occasional incorrect selections on
  some question sets.
- Auto mode should be treated as experimental. It can stop when confidence is low,
  but it is not yet a deterministic end-to-end solver for every supported page type.
- Grammar exercises with reorderable sentence parts are supported only partially;
  visual ordering hints may still need refinement.

## Detection Notes

- Vocabulary text: reads `vocabulary/data/vocabulary.json`, matches the visible
  question text, then selects the choice image whose `alt` matches the correct
  question id.
- Vocabulary voice: captures MP3 URLs loaded by the page at document start and maps
  the audio id back to `vocabulary.json`. If no audio id has been captured, it
  highlights only and refuses automatic clicking.
- Kanji read/find: reads `kanji/data/read|find/lessonN.json` and uses `answerId`.
- Grammar: uses visible native controls such as `Answers` and `Next` because the
  inspected grammar page is HTML/script driven rather than JSON-answer driven.

## Development

```bash
npm run dev
npm run lint
```

The Vite preview page is only for UI work. Solver behavior requires loading the
built `dist/` folder as a Chrome extension.
