/*
 * Transfer rate and time-remaining for the progress surfaces.
 *
 * Two rules keep the estimate from lying:
 *
 *   1. Say nothing until there is a real signal. A rate derived from the first
 *      few hundred milliseconds of a connection is dominated by the TCP slow
 *      start and reports "2 seconds left" for a 40 minute transfer, which is
 *      worse than no estimate at all.
 *   2. Use the average rate since the transfer started, not the instantaneous
 *      rate. An average converges and never swings; an instantaneous rate makes
 *      the countdown jitter and can ratchet upwards on every scheduling hiccup.
 */

/*
 * How much signal to demand before showing a number. Both conditions must hold.
 * WARMUP_BYTES keeps a fast local transfer honest, WARMUP_MS keeps a slow one
 * from dividing a handful of bytes by a heartbeat.
 */
const WARMUP_BYTES = 512 * 1024;
const WARMUP_MS = 1500;

/* Past this, round to whole minutes: "94 min" is easier to act on than "1 h 34 min". */
const COARSE_SECONDS = 600;

export class TransferTiming {
  constructor(now = Date.now()) {
    this.reset(now);
  }

  reset(now = Date.now()) {
    this.startedAt = now;
    this.startedAtBytes = 0;
    this.startedAtKnown = false;
  }

  /*
   * Called with the running byte total. The first non-zero call anchors the
   * clock rather than the constructor doing it, because a sender spends its
   * first ticks encrypting, which would otherwise be billed to the transfer.
   *
   * The second parameter is a timestamp in milliseconds, not a size. Passing a
   * byte count here once produced a start date of 1970 and an estimate
   * measured in millions of hours, which is a spectacularly unhelpful way to
   * learn that argument order matters.
   */
  update(bytesSent, now = Date.now()) {
    if (!this.startedAtKnown && bytesSent > 0) {
      this.startedAt = now;
      this.startedAtBytes = bytesSent;
      this.startedAtKnown = true;
    }
  }

  elapsedMs(now = Date.now()) {
    return this.startedAtKnown ? Math.max(0, now - this.startedAt) : 0;
  }

  /*
   * Bytes per second since the transfer started, or 0 if not yet measurable.
   *
   * `now` is a parameter rather than an internal Date.now() so that eta() and
   * rate() cannot disagree, and so the arithmetic is deterministic under test.
   */
  rate(bytesSent, totalBytes, now = Date.now()) {
    if (!this.startedAtKnown) {
      return 0;
    }
    const moved = bytesSent - this.startedAtBytes;
    const seconds = this.elapsedMs(now) / 1000;
    if (moved <= 0 || seconds <= 0) {
      return 0;
    }
    /*
     * Once the whole thing has arrived a rate is meaningless, and dividing by
     * it would yield a negative or infinite time remaining. Compare bytes sent
     * against the total, not bytes moved: the clock is anchored at a nonzero
     * offset, so the two are never equal.
     */
    if (totalBytes && bytesSent >= totalBytes) {
      return 0;
    }
    return moved / seconds;
  }

  /*
   * Seconds remaining, or null while the estimate would be noise. Callers show
   * nothing rather than a placeholder for null.
   */
  eta(bytesSent, totalBytes, now = Date.now()) {
    if (!this.startedAtKnown || !totalBytes) {
      return null;
    }
    const moved = bytesSent - this.startedAtBytes;
    if (moved < WARMUP_BYTES || now - this.startedAt < WARMUP_MS) {
      return null;
    }
    const remaining = totalBytes - bytesSent;
    if (remaining <= 0) {
      return 0;
    }
    const perSecond = this.rate(bytesSent, totalBytes, now);
    if (!(perSecond > 0)) {
      return null;
    }
    return remaining / perSecond;
  }
}

/*
 * A duration a person can act on, and that still ticks convincingly while it
 * counts down. Seconds below a minute, minutes and seconds below ten minutes so
 * the countdown visibly moves, then whole minutes because at that range the
 * precision is false anyway.
 */
export function formatDuration(seconds) {
  if (!(seconds >= 0) || !Number.isFinite(seconds)) {
    return '';
  }
  const total = Math.round(seconds);
  if (total < 60) {
    return `${total}s`;
  }
  if (total < COARSE_SECONDS) {
    const minutes = Math.floor(total / 60);
    return `${minutes}m ${total % 60}s`;
  }
  const minutes = Math.round(total / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
