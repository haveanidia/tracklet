import type { Box, Quad } from '../../types';

/** RGBA pixels, already scaled to the tracking resolution. */
export interface ImageFramePayload {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface WorkerTargetInput {
  id: string;
  x: number;
  y: number;
  box?: Box;
  quad?: Quad;
}

export interface TrackingWorkerSettings {
  searchWindow: number;
  sensitivity: number;
  confidenceThreshold: number;
}

export interface WorkerTargetResult {
  id: string;
  x: number;
  y: number;
  confidence: number;
  box?: Box;
  quad?: Quad;
  lost?: boolean;
  message?: string;
}

export type TrackingWorkerRequest =
  | {
      type: 'start';
      mode: 'point' | 'region' | 'planar';
      frame: ImageFramePayload;
      frameNumber: number;
      target: WorkerTargetInput;
      settings: TrackingWorkerSettings;
    }
  | { type: 'frame'; frame: ImageFramePayload; frameNumber: number }
  | { type: 'dispose' };

export type TrackingWorkerResponse =
  | { type: 'ready' }
  | { type: 'started'; frameNumber: number; target: WorkerTargetResult }
  | { type: 'result'; frameNumber: number; target: WorkerTargetResult }
  | { type: 'error'; message: string };

export type StabilizationWorkerRequest =
  | { type: 'start'; frame: ImageFramePayload; frameNumber: number }
  | { type: 'frame'; frame: ImageFramePayload; frameNumber: number }
  | { type: 'dispose' };

export interface CameraMotionResult {
  frame: number;
  dx: number;
  dy: number;
  angle: number;
  scale: number;
  confidence: number;
  featureCount: number;
  redetected: boolean;
}

export type StabilizationWorkerResponse =
  | { type: 'ready' }
  | { type: 'started'; frameNumber: number }
  | { type: 'result'; motion: CameraMotionResult }
  | { type: 'error'; message: string };
