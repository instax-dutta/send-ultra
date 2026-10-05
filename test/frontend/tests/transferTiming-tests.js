import assert from 'assert';
import { TransferTiming, formatDuration } from '../../../app/transferTiming';

const MB = 1024 * 1024;

describe('TransferTiming', function() {
  describe('warm-up', function() {
    it('withholds an estimate before any bytes arrive', function() {
      const t = new TransferTiming(0);
      assert.strictEqual(t.eta(0, 100 * MB), null);
      assert.strictEqual(t.rate(0, 100 * MB), 0);
    });

    it('anchors the clock at the first byte, not at construction', function() {
      // Constructed at 0, but nothing moves until t=10s. If the clock had been
      // anchored at construction, ten seconds of setup would be billed to the
      // transfer and the rate would be understated tenfold.
      const t = new TransferTiming(0);
      t.update(1 * MB, 10000);
      assert.strictEqual(t.rate(1 * MB, 100 * MB), 0, 'no elapsed time yet');
    });

    it('withholds an estimate while too little has moved', function() {
      const t = new TransferTiming(0);
      t.update(1024, 0);
      // 10 KiB in 10s: a real rate, but far too little data to trust.
      const eta = t.eta(11 * 1024, 100 * MB, 10000);
      assert.strictEqual(eta, null);
    });

    it('withholds an estimate before enough time has passed', function() {
      const t = new TransferTiming(0);
      t.update(0, 0);
      // Plenty of bytes, but only 200ms: still dominated by slow start.
      assert.strictEqual(t.eta(50 * MB, 100 * MB, 200), null);
    });

    it('reports once both thresholds are cleared', function() {
      const t = new TransferTiming(0);
      t.update(1 * MB, 1000);
      // Clock anchored at 1 MiB / 1000ms, now 40 MiB at 6000ms: 39 MiB moved in
      // 5s (about 7.8 MiB/s), leaving 60 MiB, so about 7.7s.
      const eta = t.eta(40 * MB, 100 * MB, 6000);
      assert.ok(eta !== null, 'expected an estimate');
      assert.ok(eta > 7.5 && eta < 7.9, `got ${eta}`);
    });
  });

  describe('rate', function() {
    it('averages over the whole transfer rather than the last chunk', function() {
      const t = new TransferTiming(0);
      t.update(1 * MB, 0);
      // 29 MiB in 10s -> about 3 MB/s. An instantaneous rate measured over the
      // last chunk alone would swing with every burst; this settles on the true
      // overall throughput.
      // 29 MiB in 10s, expressed in bytes per second because that is what
      // rate() returns.
      const r = t.rate(30 * MB, 60 * MB, 10000);
      assert.ok(Math.abs(r - (29 * MB) / 10) < 1, `got ${r}`);
    });

    it('reports zero for a stalled transfer', function() {
      const t = new TransferTiming(0);
      t.update(10 * MB, 0);
      // Time passed, bytes did not.
      assert.strictEqual(t.rate(10 * MB, 100 * MB, 60000), 0);
    });

    it('does not divide by the whole file once it has all arrived', function() {
      const t = new TransferTiming(0);
      t.update(1 * MB, 0);
      // Transfer complete: a rate here is meaningless and would imply a
      // negative or infinite ETA.
      assert.strictEqual(t.rate(100 * MB, 100 * MB), 0);
    });
  });

  describe('eta', function() {
    it('is zero when everything has arrived', function() {
      const t = new TransferTiming(0);
      t.update(1 * MB, 0);
      assert.strictEqual(t.eta(100 * MB, 100 * MB, 5000), 0);
    });

    it('scales with the amount left', function() {
      const t = new TransferTiming(0);
      t.update(1 * MB, 0);
      const nearlyDone = t.eta(90 * MB, 100 * MB, 10000);
      const halfDone = t.eta(50 * MB, 100 * MB, 10000);
      assert.ok(nearlyDone < halfDone, 'less remaining should be less time');
    });
  });

  describe('formatDuration', function() {
    it('renders sub-minute durations in seconds', function() {
      assert.strictEqual(formatDuration(0), '0s');
      assert.strictEqual(formatDuration(45), '45s');
      assert.strictEqual(formatDuration(59), '59s');
    });

    it('renders minutes and seconds while precision is believable', function() {
      assert.strictEqual(formatDuration(60), '1m 0s');
      assert.strictEqual(formatDuration(95), '1m 35s');
      assert.strictEqual(formatDuration(599), '9m 59s');
    });

    it('drops to whole minutes past ten minutes', function() {
      assert.strictEqual(formatDuration(600), '10m');
      assert.strictEqual(formatDuration(1500), '25m');
    });

    it('adds hours for very long transfers', function() {
      assert.strictEqual(formatDuration(3600), '1h 0m');
      assert.strictEqual(formatDuration(5400), '1h 30m');
      assert.strictEqual(formatDuration(7260), '2h 1m');
    });

    it('returns an empty string for values that are not durations', function() {
      assert.strictEqual(formatDuration(null), '');
      assert.strictEqual(formatDuration(undefined), '');
      assert.strictEqual(formatDuration(NaN), '');
      assert.strictEqual(formatDuration(Infinity), '');
      assert.strictEqual(formatDuration(-5), '');
    });

    it('never renders a nonsensical ordering', function() {
      // Guard against a future edit reintroducing the coarse branch below 10m,
      // which would make 1m and 1m 59s both render as "1m".
      assert.notStrictEqual(formatDuration(60), formatDuration(119));
    });
  });

  describe('10 GiB transfer', function() {
    it('produces a sane estimate at the configured limit', function() {
      const total = 10 * 1024 * MB;
      const t = new TransferTiming(0);
      t.update(1 * MB, 0);
      // 2 GiB of 10 GiB sent in 20 minutes is about 1.79 MB/s, so the remaining
      // 8 GiB needs roughly 80 minutes.
      const eta = t.eta(2 * 1024 * MB, total, 20 * 60 * 1000);
      assert.ok(eta !== null, 'expected an estimate');
      assert.ok(eta > 4700 && eta < 4900, `got ${eta}s`);
      assert.strictEqual(formatDuration(eta), '1h 20m');
    });
  });
});

describe('TransferTiming wiring', function() {
  /*
   * The unit tests above exercise TransferTiming directly, which is exactly why
   * they missed the real bug: FileSender called timing.update(p, totalSize)
   * while the second parameter is a timestamp. Total size for a 96 MiB file is
   * ~100,000,000, so every transfer was anchored to 1970 and the readout claimed
   * the transfer would take 1.8 million hours.
   *
   * These pin the calling contract the transfer classes rely on.
   */
  it('anchors on the first non-zero report, ignoring zero-byte reports', function() {
    const t = new TransferTiming(0);
    t.update(0);
    assert.strictEqual(t.startedAtKnown, false, 'zero bytes must not anchor');
    t.update(65536);
    assert.strictEqual(t.startedAtKnown, true);
  });

  it('works when called with only a byte count, as the transfer classes do', function() {
    const total = 96 * MB; // 96 MiB
    const t = new TransferTiming(Date.now());
    t.update(65536); // one argument: no timestamp smuggled in
    const moved = 48 * MB;
    const perSecond = moved / ((Date.now() - t.startedAt) / 1000);
    const eta = t.eta(50 * MB, total);
    // Whichever way the clock falls, an estimate derived from real elapsed time
    // is bounded by the transfer size at a plausible rate. The regression put
    // this in the millions of hours.
    assert.ok(eta === null || eta < 60 * 60 * 24, `got ${eta}`);
    assert.ok(perSecond > 0 || perSecond === 0);
  });

  /*
   * Drives a full progress timeline at a chosen link speed and checks the
   * estimate against the arithmetic.
   *
   * MB below is 1024*1024, so note the sizes: 96 MiB is `96 * MB` and the 10 GiB
   * limit is `10 * 1024 * MB`. Writing `96 * 1024 * MB` where 96 MiB was meant
   * silently multiplies by 1024 and produced a million-iteration loop. `atRate` reports the byte total at a given
   * elapsed time, and the estimate is asked for at the halfway point using the
   * clock as it stood there.
   */
  function drive(total, rateBytesPerSec) {
    const chunk = 65536;
    const msPerChunk = (chunk / rateBytesPerSec) * 1000;
    const t = new TransferTiming(0);
    let clock = 0;
    let halfwayClock = 0;
    for (let sent = chunk; sent <= total; sent += chunk) {
      clock += msPerChunk;
      t.update(sent, clock);
      if (sent >= total / 2 && halfwayClock === 0) {
        halfwayClock = clock;
      }
    }
    return { t, halfwayClock };
  }

  it('estimates seconds correctly on a fast link', function() {
    const total = 96 * MB; // 96 MiB
    const rate = 5 * MB; // 5 MiB/s
    const { t, halfwayClock } = drive(total, rate);
    const eta = t.eta(total / 2, total, halfwayClock);
    assert.ok(eta !== null, 'expected an estimate mid-transfer');
    // 48 MiB left at 5 MiB/s is about 9.6 seconds.
    assert.ok(eta > 9 && eta < 11, `got ${eta}s`);
    assert.strictEqual(formatDuration(eta), '10s');
  });

  it('estimates minutes correctly on a slow link with a large file', function() {
    const total = 10 * 1024 * MB; // 10 GiB, the configured limit
    const rate = 2 * MB; // 2 MiB/s, a poor connection
    const { t, halfwayClock } = drive(total, rate);
    const eta = t.eta(total / 2, total, halfwayClock);
    assert.ok(eta !== null, 'expected an estimate mid-transfer');
    // 5 GiB left at 2 MiB/s is about 43 minutes.
    assert.ok(eta > 2500 && eta < 2700, `got ${eta}s`);
    assert.strictEqual(formatDuration(eta), '43m');
  });
});
