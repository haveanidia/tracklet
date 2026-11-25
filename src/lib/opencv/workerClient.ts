import type {
  ImageFramePayload,
  StabilizationWorkerRequest,
  StabilizationWorkerResponse,
  TrackingWorkerRequest,
  TrackingWorkerResponse,
} from '../opencv/protocol';

interface PendingWaiter<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Small request/response wrapper around a CV worker. A fresh worker is created
 * per job so OpenCV memory is reclaimed when the job ends or crashes.
 */
class CvWorker<TRequest, TResponse extends { type: string }> {
  private worker: Worker;
  private queue: TResponse[] = [];
  private waiter: PendingWaiter<TResponse> | null = null;
  private readyWaiter: PendingWaiter<void> | null = null;
  private failure: Error | null = null;
  readonly ready: Promise<void>;

  constructor(factory: () => Worker) {
    this.worker = factory();
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyWaiter = { resolve, reject };
    });
    this.worker.onmessage = (event: MessageEvent<TResponse>) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        this.readyWaiter?.resolve();
        this.readyWaiter = null;
        return;
      }
      if (msg.type === 'error') {
        const error = new Error((msg as unknown as { message: string }).message || 'Computer-vision worker failed.');
        this.failure = error;
        this.readyWaiter?.reject(error);
        this.readyWaiter = null;
        this.waiter?.reject(error);
        this.waiter = null;
        return;
      }
      if (this.waiter) {
        const resolve = this.waiter.resolve;
        this.waiter = null;
        resolve(msg);
      } else {
        this.queue.push(msg);
      }
    };
    this.worker.onerror = (event) => {
      const message = event.message || 'The computer-vision worker crashed.';
      const error = new Error(
        /memory/i.test(message)
          ? 'The worker ran out of memory. Try a lower tracking resolution or a shorter range.'
          : `Computer-vision worker error: ${message}`,
      );
      this.failure = error;
      this.readyWaiter?.reject(error);
      this.readyWaiter = null;
      this.waiter?.reject(error);
      this.waiter = null;
    };
  }

  async init(timeoutMs = 60000): Promise<void> {
    await Promise.race([
      this.ready,
      new Promise<void>((_, reject) =>
        window.setTimeout(
          () => reject(new Error('OpenCV.js took too long to load. Reload the page and try again.')),
          timeoutMs,
        ),
      ),
    ]);
  }

  next(timeoutMs = 45000): Promise<TResponse> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<TResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiter = null;
        reject(new Error('The tracker stopped responding. The worker may have crashed.'));
      }, timeoutMs);
      this.waiter = {
        resolve: (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  post(message: TRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }

  dispose() {
    const abort = new DOMException('Job cancelled', 'AbortError');
    this.failure = abort;
    this.readyWaiter?.reject(abort);
    this.readyWaiter = null;
    this.waiter?.reject(abort);
    this.waiter = null;
    try {
      this.worker.postMessage({ type: 'dispose' });
    } catch {
      // worker may already be gone
    }
    this.worker.terminate();
  }
}

export function createTrackingClient() {
  return new CvWorker<TrackingWorkerRequest, TrackingWorkerResponse>(
    () => new Worker(new URL('../../workers/tracking.worker.ts', import.meta.url), { type: 'module' }),
  );
}

export function createStabilizationClient() {
  return new CvWorker<StabilizationWorkerRequest, StabilizationWorkerResponse>(
    () => new Worker(new URL('../../workers/stabilization.worker.ts', import.meta.url), { type: 'module' }),
  );
}

export type Frame = ImageFramePayload;
