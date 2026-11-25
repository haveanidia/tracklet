import type { PreviewSettings } from '../../types';

export const defaultPreviewSettings = (): PreviewSettings => ({
  quality: 'full',
  showOverlays: true,
  showPaths: true,
  showConfidence: false,
  showSafeFrame: false,
  compare: false,
});
