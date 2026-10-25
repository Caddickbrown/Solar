# Solar

A solar system you can look at from above, and a sky you can look at from the ground. Keplerian planet positions from JPL's elements, the Moon from a truncated Meeus series, and the real bright-star catalogue behind it all.

![The system, spaced out so the inner planets are readable](docs/system.png)

## Three ways in

**System** — the orrery. Procedural planet surfaces lit from the Sun, Earth with day and night lights at its real rotation, Saturn's rings with Cassini's gap and the planet's shadow, each planet tilted on its real pole. Orbits brighten behind each planet. Click anything to fly to it and follow it. *Spaced scale* compresses distance (∝ √AU) so Mercury isn't on top of the Sun; *True scale* is linear.

![Saturn, close up](docs/saturn.png)

**Sky** — the view from where you stand. A draggable, zoomable dome with 2,300 real stars, constellation lines, named stars, the ecliptic, and the Sun, Moon and planets in place. The sky colour follows the Sun's altitude and the faintest visible star follows twilight. The Moon is drawn with its true phase and bright limb.

![The sky from London](docs/sky.png)

![Dusk, a waxing crescent in the south-west](docs/sky-dusk.png)

**Tonight** — the left column, always on: sunset, fully dark window and sunrise; the Moon's phase, rise and set and the next phases (click to jump there); what's up and when each planet rises; an altitude-against-time chart of the whole night; and any pair of bodies closer than 6°.

## Time

Real time by default. The slider runs from 100 years/second backward to 100 years/second forward. Click the date to jump anywhere. `Now` snaps back.

## Place

Click the coordinates (top right) to set latitude and longitude. Saved in the browser. Clock times use the browser's time zone.

## URL parameters

`?t=2026-11-14T16:50:00Z` start time · `&paused=1` · `&mode=sky` · `&sel=Saturn` · `&speed=2` (slider step) · `&lat=51.5&lon=-0.1`

## Running

No build step. Serve the folder:

```bash
python3 -m http.server 8965
```

On the Pi it runs as the user unit `solar.service` on port 8965.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Layout and type |
| `main.js` | Scene, clock, UI, camera |
| `planets.js` | Planet / Sun / ring / orbit / starfield shaders |
| `sky.js` | The stereographic sky dome (canvas 2D) |
| `tonight.js` | Twilight, rise/set, night tracks, close approaches |
| `moon.js` | Moon and Sun positions, phase, phase search |
| `elements.js`, `kepler.js`, `astronomy.js`, `horizon.js` | Orbital elements, solver, coordinates, altitude and horizon crossings |
| `assets/` | Fonts, star catalogue (`sky.json`), Earth and Moon maps, three.js |

## Accuracy

Planets use JPL's approximate elements (J2000, 3000 BC – 3000 AD): arcminutes. The Moon is good to about 0.3°; rise and set ignore parallax and refraction, so expect a few minutes of error. Coordinates are J2000 throughout, so alt/az is off by about 0.37° of precession.

## Credits

Orbital elements: [JPL SSD](https://ssd.jpl.nasa.gov/planets/approx_pos.html). Stars and constellation lines: [d3-celestial](https://github.com/ofrohn/d3-celestial) (Hipparcos-derived). Earth and Moon maps: three.js examples. Type: Newsreader and Outfit.
