# Tracklet

Browser-based motion tracking studio. Import a clip, track points, regions or planar surfaces, lock a subject in frame or smooth the camera, attach overlays, then export the tracking data, a stabilized render, or a portable project file. Everything runs locally in the tab; nothing is uploaded.

## Stack

React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, OpenCV.js (`@techstark/opencv-js`), `mp4-muxer`, Canvas 2D, Web Workers, WebCodecs with a MediaRecorder WebM fallback, IndexedDB for autosave.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle
npm test           # unit tests (interpolation, transforms, exporters)
```

The first tracking or stabilization job downloads/pre-bundles the ~13 MB OpenCV.js build. Jobs use a fresh worker and are terminated afterwards so OpenCV memory is reclaimed.

## Using it

1. **Import** an MP4, WebM or MOV by drag-and-drop or the Import button. Decoding depends on the browser's codec support; if the browser cannot decode the file the import fails honestly instead of guessing metadata.

2. **Point tracker (P)** — click a feature, then **Track** forward or **Backward**. Tracking starts from the playhead using the nearest/interpolated keyframe.

3. **Region tracker (R)** — drag a box around a textured area. Affine Lucas–Kanade tracks the corners inside the box.

4. **Planar tracker (G)** — drag around a flat, detailed surface. ORB descriptors plus RANSAC homography track the plane. Experimental: strong perspective change, motion blur or low texture will lose it.

5. **Stabilizer (S)** — two modes, both in the right-hand inspector:
   - **Subject Lock** holds a tracked point or region at a fixed anchor in the output frame. Track the subject first, choose the source track, set the anchor (default: frame centre) and optional H/V offset, then **Lock subject**. It reuses existing track coordinates and never invents motion.
   - **Smooth Camera** analyzes background features in a worker, smooths the camera path, keeps intentional pans, and corrects rotation, jitter and scale drift.

   Both modes share strength, smoothing, responsiveness, rotation correction and a dead zone. Adaptive zoom derives the required crop from the transform, keeps the aspect ratio and never stretches the picture; set maximum/minimum zoom, zoom smoothing and a safety margin. If the maximum is too low you get a warning while the subject stays locked. The viewer offers Original / A/B split / Stabilized, an anchor marker, a safe-frame overlay and the live zoom percentage. The timeline shows subject and output position, zoom, rotation and confidence with a per-frame readout. **Reset stabilization settings** restores defaults without touching the analysis or the tracks.

6. **Overlays (O)** — attach text, image or shape overlays to a tracked object and edit offset, size, rotation, scale, anchor, opacity and color in the inspector.

7. **Edit keyframes** in the inspector (X/Y, width/height) or by dragging the marker in the viewer. Every correction is undoable (`Ctrl+Z`, `Ctrl+Shift+Z`).

8. **Export** JSON, CSV, SVG motion paths, an After Effects `.jsx` (null layers, not an `.aep`), a stabilized H.264 MP4 (WebCodecs; real-time WebM fallback when the encoder rejects the config) or a `.tracklet.json` project.

Video export applies the same baked warp as the preview at the original frame rate and aspect ratio (or a chosen output height) and preserves the source audio track. AAC audio is muxed with WebCodecs when the browser can encode it; otherwise the real-time WebM fallback keeps the source audio. If audio cannot be captured at all the dialog says so instead of dropping it silently.

Shortcuts: `Space` play/pause, `←/→` step (Shift = 10), `Home/End`, `F` fit view, `V/P/R/G/S/O` tools.

## Projects and storage

Projects autosave to IndexedDB with their tracking data, overlays, stabilization corrections and the imported video blob. The most recent project is restored on reload. A `.tracklet.json` file does not embed video: open it on another machine and re-link the original clip.

If the browser refuses to store the video blob (quota or private mode), tracking data is still saved and the viewer asks you to re-link the media.

## Limits

- Stabilization cannot hide every border when the subject sits far from the anchor and the maximum zoom is reached. The subject is prioritised and the inspector warns; raise Maximum zoom or move the anchor closer to the subject path.
- Video export is a stabilized render (corrections applied); overlays are burned in, tracking markers are not. The viewer's Original/A-B choice only affects the preview.
- Exported audio is AAC in MP4 when the browser supports `AudioEncoder` for AAC; otherwise export falls back to a real-time WebM recording that carries the source audio track. A browser with neither path reports the missing audio.
- MOV/ProRes support depends on the browser decoder; only codecs the browser can play are importable.
- FFmpeg.wasm is not bundled. The fallback recorder captures in real time and can drop frames if the machine is busy.
- Planar tracking is sensitive to texture and perspective; it is labeled experimental in the UI.
- Tracking is frame-accurate only for constant-frame-rate sources; variable frame rate imports use the measured average fps (override it in Project settings).
- Proxy resolutions (480p/720p/1080p) trade track precision for speed. Coordinates are always stored in source pixels.

## Tests

`npm test` covers pure logic only: keyframe interpolation/smoothing, Subject Lock and Smooth Camera transforms (translation, rotation, jitter, confidence loss, adaptive zoom limits, portrait/landscape coverage, preview/export parity) and the JSON/CSV/SVG/AE exporters. Worker/OpenCV and UI flows are verified manually in a browser.

## License

MIT License

## Credits

Built by the Tracklet team. Uses OpenCV.js, Zustand, Vite, Tailwind CSS and other open source tools.