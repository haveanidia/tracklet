# tracklet
Free, lightweight, browser-based motion tracking tool.

# Tracklet

<p align="center">
  <strong>Motion tracking, without the overhead.</strong>
</p>

Tracklet is a free, open-source motion tracking tool built for creators who just want to track something and get on with editing.

No expensive software. No free trials. No complicated editing workflow.

Track an object, capture its movement, and use it for montages, edits, motion graphics, and more.

---

## Why Tracklet?

Sometimes you don't need a full video editor.

You just want to track someone's movement in a clip, attach something to it, stabilize footage, or get motion data for an edit. Opening a massive editing suite for that can feel like overkill.

Tracklet was built to make that process simpler.

- **Free** — No subscriptions, paid features, or trial periods.
- **Lightweight** — Focused on motion tracking rather than a full editing suite.
- **Simple** — Track objects without learning a complex editing workflow.
- **Local** — Run Tracklet on your own computer.
- **Open source** — Free to use, modify, and contribute to.

## Features

- Point-based motion tracking
- Track objects across video frames
- Visual tracking workflow
- Motion data and tracking paths
- Video preview and timeline
- Motion-based stabilization
- Subject locking
- Export tools

## Getting Started

Tracklet runs locally on your computer.

### Requirements

- Node.js
- npm
- A modern browser

### Installation

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/tracklet.git
cd tracklet
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL provided by Vite in your browser.

### Build

To create a production build:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## How It Works

1. Open Tracklet.
2. Create a project and import your video.
3. Select the point or object you want to track.
4. Run the tracker.
5. Review and use the resulting motion data.
6. Apply your tracking to your edit.

The goal is to get from video to usable tracking data as quickly as possible.

## Use Cases

Tracklet is made for things like:

- Video montages
- Velocity edits
- Motion graphics
- Object-following effects
- Subject locking
- Camera stabilization
- Attaching text or images to tracked movement

## Privacy

Tracklet is designed to run locally on your computer.

Your videos are not intended to be uploaded to a Tracklet cloud service. Processing and storage behavior depend on the local implementation and browser capabilities.

## Roadmap

- [ ] Improve tracking accuracy and reliability
- [ ] Better handling of occlusion and objects leaving the frame
- [ ] More tracking controls
- [ ] Improved stabilization
- [ ] More export options
- [ ] Performance improvements
- [ ] Better project management
- [ ] Continued UI and workflow improvements

The roadmap may change as development continues.

## Contributing

Contributions are welcome.

If you find a bug, have an idea, or want to improve Tracklet:

- Open an issue.
- Suggest a feature.
- Submit a pull request.

If you're making a major change, consider opening an issue first so we can discuss it.

## License

Tracklet is open source. See the `LICENSE` file for license details.

---

**Tracklet — Track anything. Make something with it.**
