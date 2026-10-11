# Cartoon Solar System

An interactive Three.js model of the solar system with cartoon-style planets. It works with a mouse or a touchscreen.

![Overview of the cartoon solar system with orbits, labels and the speed controls](docs/screenshot.png)

![Close-up of Saturn with its rings, Titan and the info panel](docs/saturn.png)

## Features

- **Real orbits.** Each orbit uses JPL's J2000 orbital elements: real eccentricity, inclination and perihelion direction. The positions are solved with Kepler's equation, so planets speed up near the Sun. On load, every body is placed where it actually is today.
- **Relative speeds.** Periods follow Kepler's third law. At 1× speed, Earth takes 60 s per orbit, Mercury about 14 s, and Neptune about 2.7 hours. The slider runs from 0.1× to 50×.
- **Date picker.** Click the date under the title to jump to any day from 1800 to 2300. Jumping forward fast-forwards time, so rockets keep flying, launching and landing on schedule. Jumping backward glides the planets to their positions on that date.
- **Align ↑ / Align ↓** moves every planet (and Pluto) forward along its own orbit until they form a straight line above or below the Sun. **Now** puts them back at today's real positions.
- **Cartoon planets** with their best-known features:
  - Mercury's craters
  - Venus's swirling clouds
  - Earth's continents, clouds and a hurricane, plus the Moon
  - Mars's polar caps, Olympus Mons and Valles Marineris, plus Phobos and Deimos
  - Jupiter's bands and Great Red Spot, plus the Galilean moons
  - Saturn's rings (with the Cassini division), polar hexagon and Titan
  - Uranus tipped on its side with vertical rings
  - Neptune's Great Dark Spot and Triton
  - Pluto's heart, plus Charon
- **Rockets.** Open **🚀 Rockets**, pick a start and a destination planet, and optionally name the rocket (it defaults to "Rocket 1", "Rocket 2", …).
  - Each rocket coasts on a real two-body orbit around the Sun, found by solving Lambert's problem so that it meets the target planet when it arrives. Of all trips that leave right away and take 0.5× to 1.6× the Hohmann transfer time, it picks the one that needs the least Δv. Earth to Mars takes about 8–10 months, which is 40–50 s at 1×.
  - **Launch now** leaves immediately on the cheapest trip for today. The panel also shows the best launch window in the next synodic period: the date when the same fuel (or less) gets the rocket there fastest. **Wait for window** keeps the rocket on the planet until then, and **Jump & launch** skips ahead to that date and launches.
  - With **Orbits** on, each rocket draws its path: solid where it has been and dashed where it is going.
  - Tap a rocket, its label or its entry in the list to follow it. After an **Align** or **Now** jump, rockets in flight make a mid-course correction toward the target's new position.
- **Other objects:** the asteroid belt (with Kirkwood gaps), the Kuiper belt, and Halley's Comet on its retrograde orbit, with a tail that grows near the Sun and points away from it.
- **Controls:**
  - Drag to rotate.
  - Use the mouse wheel or a two-finger pinch to zoom.
  - Tap or click a planet, its label or its chip to fly to it and watch it spin (1×, 10× or 100× spin speed).
  - **← Solar System** or `Esc` returns to the overview, and `Space` pauses.

### Scale notes
Real distances are too large to show at once, so semi-major axes are compressed with a power law (`34 · AU^0.65`). Each ellipse still keeps its real eccentricity, so the orbit *shapes* are accurate. Planet sizes are exaggerated. Spin and moon motion run on a separate, slower clock (Earth day = 6 s at 1×), because at orbital speed Earth would spin 365 times a minute.

## Run locally
```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN for phone testing)
```

## Deploy with Docker
```bash
cp .env.example .env              # then set HOST_PORT to a free port on your server
docker compose up -d --build      # serves on http://<server>:<HOST_PORT>
```
`HOST_PORT` defaults to 8080 if `.env` is missing. The container always listens on 8080 internally.
Or without compose:
```bash
docker build -t cartoon-solar-system .
docker run -d --name solar-system -p 8080:8080 --restart unless-stopped cartoon-solar-system
```
The image uses a multi-stage build: Node builds the static site, and an unprivileged, non-root `nginx-unprivileged:alpine-slim` image serves it (~20 MB). `apk upgrade` runs at build time, so rebuild periodically to pick up security fixes. Asset paths are relative, so the site also works behind a reverse proxy at a sub-path such as `/solar/`. The container has a health endpoint at `/healthz`.
