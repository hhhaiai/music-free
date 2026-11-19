export type PlaybackSnapshot = {
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  readyState: number;
  bufferedSeconds: number;
};

export class PlaybackController {
  private readonly media: HTMLMediaElement;

  constructor(media: HTMLMediaElement) { this.media = media; }

  play(): Promise<void> {
    return this.media.play();
  }

  pause(): void {
    this.media.pause();
  }

  async toggle(): Promise<boolean> {
    if (this.media.paused) {
      await this.play();
      return true;
    }
    this.pause();
    return false;
  }

  seek(seconds: number): number {
    const max = Number.isFinite(this.media.duration) ? this.media.duration : Number.POSITIVE_INFINITY;
    const next = Math.min(Math.max(0, Number.isFinite(seconds) ? seconds : 0), max);
    this.media.currentTime = next;
    return next;
  }

  setVolume(value: number): number {
    const next = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
    this.media.volume = next;
    return next;
  }

  setRate(value: number): number {
    const next = Math.min(2, Math.max(0.5, Number.isFinite(value) ? value : 1));
    this.media.playbackRate = next;
    return next;
  }

  snapshot(): PlaybackSnapshot {
    let bufferedSeconds = 0;
    const time = this.media.currentTime;
    for (let i = 0; i < this.media.buffered.length; i += 1) {
      if (time >= this.media.buffered.start(i) - 0.25 && time <= this.media.buffered.end(i) + 0.25) {
        bufferedSeconds = Math.max(0, this.media.buffered.end(i) - time);
        break;
      }
    }
    return {
      paused: this.media.paused,
      currentTime: time || 0,
      duration: Number.isFinite(this.media.duration) ? this.media.duration : 0,
      volume: this.media.volume,
      muted: this.media.muted,
      playbackRate: this.media.playbackRate,
      readyState: this.media.readyState,
      bufferedSeconds,
    };
  }
}

const controllers = new WeakMap<HTMLMediaElement, PlaybackController>();
export function playbackControllerFor(media: HTMLMediaElement | null | undefined): PlaybackController | null {
  if (!media) return null;
  let controller = controllers.get(media);
  if (!controller) {
    controller = new PlaybackController(media);
    controllers.set(media, controller);
  }
  return controller;
}
