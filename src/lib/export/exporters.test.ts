import { describe, expect, it } from 'vitest';
import type { Project } from '../../types';
import { buildAEScript, buildCSV, buildMotionPathSVG, buildTrackingJSON } from './exporters';
import { defaultStabilizationSettings } from '../../features/stabilization/defaults';
import { defaultPreviewSettings } from '../../features/preview/defaults';

const project = (): Project => ({
  id: 'p1',
  name: 'Test project',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  video: {
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    size: 1024,
    width: 1920,
    height: 1080,
    duration: 2,
    fps: 30,
    fpsEstimated: false,
    frameCount: 60,
    blobSaved: true,
  },
  trackingObjects: [
    {
      id: 't1',
      name: 'Point 1',
      type: 'point',
      method: 'lk',
      color: '#4c7dff',
      startFrame: 0,
      endFrame: 15,
      confidence: 0.9,
      visible: true,
      locked: false,
      frames: [
        { frame: 0, x: 100, y: 200, confidence: 1, status: 'manual' },
        { frame: 15, x: 150, y: 250, confidence: 0.8, status: 'tracked' },
      ],
      settings: {
        searchWindow: 21,
        sensitivity: 50,
        confidenceThreshold: 0.5,
        smoothing: 0,
        direction: 'forward',
        trackingResolution: 720,
        interpolation: 'linear',
      },
    },
  ],
  overlays: [
    {
      id: 'o1',
      name: 'Label',
      type: 'text',
      trackingObjectId: 't1',
      visible: true,
      content: 'Hello',
      imageDataUrl: '',
      shape: 'rectangle',
      width: 0,
      height: 0,
      offsetX: 4,
      offsetY: -20,
      rotation: 0,
      scale: 1,
      opacity: 1,
      anchor: 'center',
      color: '#ffffff',
      fontSize: 32,
      fontWeight: 600,
    },
  ],
  stabilization: defaultStabilizationSettings(),
  exportSettings: {
    aeFps: 30,
    includeConfidence: true,
    videoFormat: 'mp4',
    quality: 'high',
    preserveAudio: true,
  },
  preview: defaultPreviewSettings(),
});

describe('buildCSV', () => {
  it('writes a header and one row per keyframe with seconds', () => {
    const csv = buildCSV(project());
    const lines = csv.trim().split('\n');
    expect(lines[0].split(',')[0]).toBe('object');
    expect(lines).toHaveLength(3);
    const cells = lines[2].split(',');
    expect(cells[0]).toBe('Point 1');
    expect(cells[2]).toBe('15');
    expect(Number(cells[3])).toBeCloseTo(0.5);
    expect(cells[5]).toBe('250');
    expect(cells[7]).toBe('tracked');
  });

  it('filters by object id', () => {
    const csv = buildCSV(project(), []);
    expect(csv.trim().split('\n')).toHaveLength(1);
  });
});

describe('buildTrackingJSON', () => {
  it('documents the coordinate system and objects', () => {
    const payload = JSON.parse(buildTrackingJSON(project()));
    expect(payload.app).toBe('Tracklet');
    expect(payload.coordinateSystem.origin).toBe('top-left');
    expect(payload.coordinateSystem.frameBase).toBe(0);
    expect(payload.trackingObjects).toHaveLength(1);
    expect(payload.trackingObjects[0].frames[1].x).toBe(150);
  });
});

describe('buildMotionPathSVG', () => {
  it('uses video dimensions and draws one polyline per track', () => {
    const svg = buildMotionPathSVG(project());
    expect(svg).toContain('width="1920" height="1080"');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('points="100,200 150,250"');
  });

  it('escapes project names in the title', () => {
    const source = project();
    source.name = 'A&B <cut>';
    expect(buildMotionPathSVG(source)).toContain('A&amp;B &lt;cut&gt;');
  });
});

describe('buildAEScript', () => {
  it('maps frames to source time and keeps pixel coordinates', () => {
    const script = buildAEScript(project());
    expect(script).toContain('pos.setValueAtTime(0, [100, 200]);');
    expect(script).toContain('pos.setValueAtTime(0.5, [150, 250]);');
    expect(script).toContain('addNull()');
    expect(script).toContain('addText("Hello")');
  });

  it('states that it is not a native After Effects project', () => {
    expect(buildAEScript(project())).toContain('does not export native .aep');
  });
});
