import type { Project, TrackingFrame, TrackingObject } from '../../types';
import { objectBoundingBox, sortedFrames } from '../tracking/trackingData';
import { roundTo } from '../math';

const escapeCsv = (value: string | number): string => {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const frameTime = (frame: number, fps: number) => roundTo(frame / (fps || 30), 6);

const frameRow = (object: TrackingObject, f: TrackingFrame, fps: number): (string | number)[] => [
  object.name,
  object.type,
  f.frame,
  frameTime(f.frame, fps),
  roundTo(f.x, 3),
  roundTo(f.y, 3),
  roundTo(f.confidence, 4),
  f.status,
  f.box ? roundTo(f.box.x, 3) : '',
  f.box ? roundTo(f.box.y, 3) : '',
  f.box ? roundTo(f.box.width, 3) : '',
  f.box ? roundTo(f.box.height, 3) : '',
  f.quad ? f.quad.map((p) => `${roundTo(p.x, 2)}:${roundTo(p.y, 2)}`).join(' ') : '',
];

/**
 * CSV coordinates are video pixels with the origin at the top-left of the
 * video. `time_s` assumes project fps; frame indexes are 0-based.
 */
export function buildCSV(project: Project, objectIds?: string[]): string {
  const fps = project.video.fps || 30;
  const header = [
    'object',
    'type',
    'frame',
    'time_s',
    'x_px',
    'y_px',
    'confidence',
    'status',
    'box_x',
    'box_y',
    'box_width',
    'box_height',
    'quad',
  ];
  const rows: string[] = [header.join(',')];
  for (const object of project.trackingObjects) {
    if (objectIds && !objectIds.includes(object.id)) continue;
    for (const f of sortedFrames(object)) {
      rows.push(frameRow(object, f, fps).map(escapeCsv).join(','));
    }
  }
  return rows.join('\n') + '\n';
}

export interface TrackingExport {
  app: 'Tracklet';
  formatVersion: 1;
  exportedAt: string;
  project: {
    id: string;
    name: string;
    fps: number;
  };
  coordinateSystem: {
    origin: 'top-left';
    units: 'video pixels';
    xAxis: 'right';
    yAxis: 'down';
    frameBase: 0;
    timeFormula: 'frame / fps';
    fps: number;
  };
  video: Project['video'];
  trackingObjects: TrackingObject[];
  overlays: Project['overlays'];
  stabilization: {
    enabled: boolean;
    crop: number;
    zoom: number;
    analyzed: boolean;
    corrections: Project['stabilization']['corrections'];
  };
}

export function buildTrackingJSON(project: Project, objectIds?: string[]): string {
  const objects = project.trackingObjects.filter((o) => !objectIds || objectIds.includes(o.id));
  const payload: TrackingExport = {
    app: 'Tracklet',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    project: { id: project.id, name: project.name, fps: project.video.fps },
    coordinateSystem: {
      origin: 'top-left',
      units: 'video pixels',
      xAxis: 'right',
      yAxis: 'down',
      frameBase: 0,
      timeFormula: 'frame / fps',
      fps: project.video.fps,
    },
    video: project.video,
    trackingObjects: objects,
    overlays: project.overlays,
    stabilization: {
      enabled: project.stabilization.enabled,
      crop: project.stabilization.crop,
      zoom: project.stabilization.zoom,
      analyzed: project.stabilization.analyzed,
      corrections: project.stabilization.corrections,
    },
  };
  return JSON.stringify(payload, null, 2);
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Motion paths drawn in video pixel space via the SVG viewBox. */
export function buildMotionPathSVG(project: Project): string {
  const objects = project.trackingObjects.filter((o) => o.frames.length > 1);
  const boxes = objects.map(objectBoundingBox).filter(Boolean);
  const width = project.video.width;
  const height = project.video.height;
  const pad = 16;
  const parts: string[] = [];
  for (const object of objects) {
    const points = sortedFrames(object).map((f) => `${roundTo(f.x, 2)},${roundTo(f.y, 2)}`);
    parts.push(
      `  <polyline fill="none" stroke="${escapeXml(object.color)}" stroke-width="2" stroke-linejoin="round" points="${points.join(' ')}" />`,
    );
    const first = object.frames[0];
    parts.push(
      `  <circle cx="${roundTo(first.x, 2)}" cy="${roundTo(first.y, 2)}" r="3" fill="${escapeXml(object.color)}" />`,
    );
  }
  const title = `Tracklet motion paths — ${project.name}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}">
  <title>${escapeXml(title)}</title>
  <desc>Coordinate mapping: 1 unit = 1 video pixel, origin top-left. ${objects.length} path(s). Boxes: ${boxes.length}.</desc>
${parts.join('\n')}
</svg>
`;
}

const jsString = (value: string) => JSON.stringify(value);

const aeKeyframes = (object: TrackingObject, fps: number, indent = '    ') => {
  return sortedFrames(object)
    .map((f) => `${indent}pos.setValueAtTime(${roundTo(f.frame / fps, 6)}, [${roundTo(f.x, 3)}, ${roundTo(f.y, 3)}]);`)
    .join('\n');
};

/**
 * ExtendScript for After Effects (File > Scripts > Run Script File).
 * Not a native .aep project — it builds layers and keyframes in the active comp.
 *
 * Mapping: frame N at time N / sourceFps seconds; position values are video
 * pixels with a top-left origin. Create the comp at the video's dimensions or
 * the keyframes will still be in source-pixel space. If the comp fps differs,
 * keyframes remain at source time, which is the safe default for imported media.
 */
export function buildAEScript(project: Project, objectIds?: string[]): string {
  const fps = project.video.fps || 30;
  const objects = project.trackingObjects.filter(
    (o) => (!objectIds || objectIds.includes(o.id)) && o.frames.length > 0,
  );
  const overlays = project.overlays.filter((o) => objects.some((obj) => obj.id === o.trackingObjectId));
  const lines: string[] = [];
  lines.push('// Tracklet → After Effects (ExtendScript, .jsx)');
  lines.push('// Run with File > Scripts > Run Script File… in After Effects.');
  lines.push('//');
  lines.push(`// Source: ${project.video.name}`);
  lines.push(`// Source fps: ${fps}  |  Source size: ${project.video.width}x${project.video.height}`);
  lines.push('// Coordinate map: video pixels, origin top-left, X right, Y down, frame 0 = time 0.');
  lines.push('// Keyframe time = frame / sourceFps. Comp fps is NOT substituted, so timing is preserved.');
  lines.push('// This script creates null layers and text layers. It does not import or replace media.');
  lines.push('// Tracklet does not export native .aep project files.');
  lines.push('');
  lines.push('(function () {');
  lines.push('  if (!app.project) { alert("Open a project first."); return; }');
  lines.push('  var comp = app.project.activeItem;');
  lines.push('  if (!comp || !(comp instanceof CompItem)) { alert("Select an active composition first."); return; }');
  lines.push('  app.beginUndoGroup("Import Tracklet tracking");');
  lines.push('');
  for (const object of objects) {
    const varName = 'trk_' + object.id.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`  // ${object.name} (${object.type})`);
    lines.push(`  var ${varName} = comp.layers.addNull();`);
    lines.push(`  ${varName}.name = ${jsString('TRK · ' + object.name)};`);
    lines.push(`  var pos = ${varName}.transform.position;`);
    lines.push(aeKeyframes(object, fps));
    lines.push('  pos.setInterpolationTypeAtKey(1, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);');
    lines.push(`  ${varName}.enabled = ${object.visible ? 'true' : 'false'};`);
    lines.push('');
  }
  for (const overlay of overlays) {
    const object = objects.find((o) => o.id === overlay.trackingObjectId);
    if (!object) continue;
    const key = overlay.id.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`  // Overlay: ${overlay.name} (${overlay.type})`);
    if (overlay.type === 'text') {
      lines.push(`  var txt_${key} = comp.layers.addText(${jsString(overlay.content)});`);
      lines.push(`  var pos_${key} = txt_${key}.transform.position;`);
      lines.push(`  var samples_${key} = [`);
      lines.push(
        sortedFrames(object)
          .map(
            (f) =>
              `    [${roundTo(f.frame / fps, 6)}, ${roundTo(f.x + overlay.offsetX, 3)}, ${roundTo(f.y + overlay.offsetY, 3)}]`,
          )
          .join(',\n'),
      );
      lines.push('  ];');
      lines.push(`  for (var i = 0; i < samples_${key}.length; i++) {`);
      lines.push(
        `    pos_${key}.setValueAtTime(samples_${key}[i][0], [samples_${key}[i][1], samples_${key}[i][2]]);`,
      );
      lines.push('  }');
      lines.push(`  txt_${key}.transform.opacity.setValue(${roundTo(overlay.opacity, 3)});`);
      lines.push(`  txt_${key}.transform.scale.setValue([${roundTo(overlay.scale * 100, 2)}, ${roundTo(overlay.scale * 100, 2)}]);`);
      lines.push(`  txt_${key}.transform.rotation.setValue(${roundTo(overlay.rotation, 3)});`);
      lines.push(`  txt_${key}.enabled = ${overlay.visible ? 'true' : 'false'};`);
    } else {
      lines.push(`  // ${overlay.type} overlays are data-only in this export. Recreate them in After Effects.`);
    }
    lines.push('');
  }
  lines.push('  app.endUndoGroup();');
  lines.push('  alert("Tracklet: imported tracking for ' + objects.length + ' object(s).");');
  lines.push('})();');
  return lines.join('\n') + '\n';
}
