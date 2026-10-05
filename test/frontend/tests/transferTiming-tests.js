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
