/**
 * Begin playback while the user gesture is still active; monitor buffering
 * concurrently. Waiting for 8 seconds of buffer BEFORE calling play() often
 * makes browsers reject audio with NotAllowedError.
 *
 * Both promises have rejection handlers installed immediately, so a rejected
 * play() is never left unhandled during buffering.
 */
export async function startBufferedPlayback<T>(
  start: () => Promise<void>,
  ready: () => Promise<T>,
): Promise<T> {
  const play = start(); // Must precede the first await.
  const observedPlay = play.then(
    () => ({ kind: "played" as const }),
    (error: unknown) => ({ kind: "play-failed" as const, error }),
  );
  const observedReady = ready().then(
    (value) => ({ kind: "ready" as const, value }),
    (error: unknown) => ({ kind: "buffer-failed" as const, error }),
  );
  const first = await Promise.race([observedPlay, observedReady]);
  if (first.kind === "play-failed" || first.kind === "buffer-failed") throw first.error;
  const played = first.kind === "played" ? first : await observedPlay;
  if (played.kind === "play-failed") throw played.error;
  const buffered = first.kind === "ready" ? first : await observedReady;
  if (buffered.kind === "buffer-failed") throw buffered.error;
  return buffered.value;
}
