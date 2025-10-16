# Detective Raccoon (Portfolio Game)

A minimal, static web app that shows a landing scene with a house. Control the raccoon with WASD/arrow keys. When near the door, an "Enter house" prompt appears (press Enter or click). It fades into a scrolling interior scene.

## Run locally
Any static server works. Examples:

- Python
  ```bash
  python3 -m http.server 5173
  ```
  Then open http://localhost:5173

- Node (if you have serve)
  ```bash
  npx serve -l 5173
  ```

## Files
- `index.html` – root HTML file
- `styles.css` – layout, UI, transition styles
- `game.js` – scene logic (movement, animation swap, door interaction, camera)
- `assets/` – provided art
  - `outside_house.jpg` – landing background
  - `idle.gif` – raccoon idle
  - `walking.gif` – raccoon walking
  - `static_downstairs.png` – inside background (wide)

## Controls
- Move: WASD or Arrow Keys
- Interact: Enter or click the on-screen button

## Tuning
All main knobs live in `game.js` under `CONFIG`:
- `raccoon.speed` – movement speed in px/sec
- `raccoon.width` – avatar render width in px
- `raccoon.spawnOutside` – starting position on the outside image (percentages)
- `raccoon.spawnInside` – starting position on the inside image (pixels)
- `outside.door` – hotspot for the door (percentages of the outside image) and `radius` for interaction range
- `transitionMs` – fade duration

If the door prompt is slightly off, tweak `outside.door.xPct`/`yPct` to align with your art.

## Notes
- The interior background is intentionally larger than the viewport; the camera follows the raccoon horizontally.
- The page disables default scrolling; the camera movement is implemented via translating the `#world` layer.
