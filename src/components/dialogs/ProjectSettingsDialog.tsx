import { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Modal, NumberField } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { deleteProjectFromDB, storageEstimate } from '../../lib/storage/db';

export function ProjectSettingsDialog({ onClose, onRelink }: { onClose: () => void; onRelink: () => void }) {
  const project = useProjectStore((s) => s.project);
  const videoFile = useProjectStore((s) => s.videoFile);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const setProjectFps = useProjectStore((s) => s.setProjectFps);
  const addNotice = useProjectStore((s) => s.addNotice);
  const closeProject = useProjectStore((s) => s.closeProject);
  const saveError = useProjectStore((s) => s.saveError);
  const [storage, setStorage] = useState<string>('Checking…');
  const [fpsDraft, setFpsDraft] = useState(project?.video.fps ?? 30);

  useEffect(() => {
    let cancelled = false;
    storageEstimate()
      .then((value) => {
        if (cancelled) return;
        setStorage(
          value
            ? `${(value.usage / 1048576).toFixed(1)} MB used of ${(value.quota / 1048576).toFixed(0)} MB quota`
            : 'Storage estimate unavailable',
        );
      })
      .catch(() => !cancelled && setStorage('Storage estimate unavailable'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!project) return null;

  const faint = 'flex justify-between gap-3 py-1 text-[10.5px] text-fg-muted';

  return (
    <Modal
      title="Project settings"
      subtitle={project.name}
      onClose={onClose}
      width={500}
      footer={
        <button className="btn" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="space-y-5">
        <label className="block">
          <span className="label">Project name</span>
          <input
            className="field"
            value={project.name}
            maxLength={120}
            onChange={(event) => setProjectName(event.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <NumberField
              label="Frame rate"
              suffix="fps"
              value={fpsDraft}
              min={1}
              max={240}
              step={0.001}
              onChange={setFpsDraft}
            />
            <button
              className="btn mt-1.5 w-full text-[10.5px]"
              disabled={fpsDraft === project.video.fps || !(fpsDraft > 0 && fpsDraft <= 240)}
              onClick={() => {
                setProjectFps(fpsDraft);
                addNotice('info', 'Frame rate updated', 'Existing keyframes keep their frame numbers; times are recalculated.');
              }}
            >
              Apply frame rate
            </button>
          </div>
          <div className="divide-y divide-line/60">
            <div className={faint}>
              <span>Measured</span>
              <span className="tnum text-fg-dim">{project.video.fps.toFixed(3)} fps</span>
            </div>
            <div className={faint}>
              <span>Source</span>
              <span className="text-fg-dim">{project.video.fpsEstimated ? 'estimated' : 'timestamps'}</span>
            </div>
            <div className={faint}>
              <span>Frames</span>
              <span className="tnum text-fg-dim">{project.video.frameCount}</span>
            </div>
            <div className={faint}>
              <span>Size</span>
              <span className="tnum text-fg-dim">
                {project.video.width}×{project.video.height}
              </span>
            </div>
            <div className={faint}>
              <span>Duration</span>
              <span className="tnum text-fg-dim">{project.video.duration.toFixed(2)}s</span>
            </div>
          </div>
        </div>

        <div className="border-t border-line pt-4">
          <div className="panel-title mb-2">Media</div>
          <div className="space-y-0.5 text-[10.5px] text-fg-muted">
            <div className="flex justify-between gap-3 py-1">
              <span>File</span>
              <span className="min-w-0 truncate font-mono text-[10px] text-fg-dim">{project.video.name}</span>
            </div>
            <div className={faint}>
              <span>Browser blob</span>
              <span className={videoFile && project.video.blobSaved ? 'text-fg-dim' : 'text-warn'}>
                {videoFile && project.video.blobSaved ? 'stored' : 'not stored'}
              </span>
            </div>
            <div className={faint}>
              <span>Local storage</span>
              <span className="tnum text-fg-dim">{storage}</span>
            </div>
          </div>
          {saveError && <p className="mt-2 text-[10.5px] text-danger">{saveError}</p>}
          <button className="btn mt-2 w-full text-[10.5px]" onClick={onRelink}>
            <Icon name="folder" size={12} /> Re-link video file
          </button>
        </div>

        <div className="border-t border-line pt-4">
          <div className="panel-title mb-2">Project ID</div>
          <p className="select-all font-mono text-[10px] text-fg-muted">{project.id}</p>
          <button
            className="btn btn-danger mt-3 w-full text-[10.5px]"
            onClick={() => {
              if (!window.confirm(`Delete “${project.name}” from local storage? This cannot be undone.`)) return;
              deleteProjectFromDB(project.id)
                .catch(() => undefined)
                .finally(() => {
                  closeProject();
                  onClose();
                });
            }}
          >
            <Icon name="trash" size={12} /> Delete local project
          </button>
          <p className="mt-1.5 text-[10px] leading-relaxed text-fg-muted">
            Deletes the saved metadata and the stored video blob from this browser. Downloaded files are unaffected.
          </p>
        </div>
      </div>
    </Modal>
  );
}
