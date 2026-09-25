# The landing postcard (M25)

2026-09-25. The user picked "Landing postcard" from the ideas list: a shareable picture of the flight. The details below are my calls.

## What you get

The end screen has a **Postcard** tab, next to Everyone's roles, Black box and Flight recorder. It draws a 1600 × 1000 postcard:

- **Greetings from {city}**, in big red letters.
- **A stamp** with the destination's code and "Flight 13", on a perforated edge. A postmark next to it says "Landed", the date and the code.
- **A photo:**
  - **3D:** a group photo of the cabin, taken the moment you open the tab.
  - **2D:** a class photo. Everyone's portrait stands in up to three rows under a blue sky on the tarmac.
  - Either way, anyone who didn't make it is faded.
- **How it ended:**
  - the winner ("The passengers win", "The saboteurs win", "No survivors"), in the team's colour;
  - the flight number and how many nights.
- **Everyone aboard:** portrait, name, role, and how they got off (made it, restrained, poisoned, blown up), in the team's colour.
  - Up to 8 players fit in one column; more (up to 24) go in two columns with smaller rows.
  - Long names are cut short with "…".

You can:

- **Save picture:** a PNG named after the destination (`flight-13-london.png`).
- **Share:** the share sheet, where the browser can share files (mostly phones).
- **Copy:** copies the image, where the browser can put images on the clipboard.

## The group photo

`Cabin3D.groupShot(aspect)` does the following:

1. **Camera.** It moves the main camera up by the ceiling, a row or so ahead of the first row a survivor sits in (the Pilot's flight deck doesn't count). So nobody left is behind the camera. The camera looks down the occupied rows, at least 84° across.
2. **Lights and your head.** The cabin lights go to day, and your own head is drawn (your first-person view hides it).
3. **Render and copy.** It renders once through the usual effects chain (bloom, vignette, grain, tone mapping), then copies the middle 8:5 of the canvas.
4. **Restore.** It puts the camera back and redraws the normal frame, all in the same task, so nothing flickers.

It returns null outside the cabin (for example while the landing cutscene plays), and then the postcard uses the class photo.

## Code

- `src/app/postcard.ts`: `drawPostcard`, `classRows`, `rosterLayout`, `headline`, `outcome`, `postcardFileName`.
- `src/tv/Postcard.tsx`: `PostcardView`, which draws the card, previews it, and offers Save, Share and Copy.
- `PhaseOverlay` / `EndScreen`:
  - The Postcard tab.
  - An `onPhoto` prop, which World supplies from `groupShot`. TV mode leaves it out and gets the class photo.
- `People.withHead(id, draw)`.

## Tests

- **Unit tests:**
  - headlines and outcomes;
  - the roster fits up to 24 aboard;
  - the class photo's rows fit the picture for 1–24 players;
  - file names (accents stripped).
- **Browser-checked:**
  - 3D and 2D postcards with 8 players, and 24-player layouts;
  - the camera placement;
  - the end-screen tab on desktop and at phone width.
