# Gates: send-ultra server correctness and performance on Node 22

OWNS: server/**, test/**, scripts/verify/**, package.json, package-lock.json

Scope: Land the audited correctness/security fixes and the server-side performance work in server/, then prove on a real Linux host running Node 22 with real Redis that the encrypted transfer path is still byte-intact and that each performance claim is measured rather than asserted.

- [x] G0: this ledger states outcomes that can fail
  CHECK: node /Users/saiduttaabhishekdash/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=ac2362a5e404f55f3e0757bb13c502652d0244eaefefbc244421b340eed8ed2a; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G1: the encrypted transfer path is byte-intact on the remote host
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/suite.mjs e2e
  EXPECT: E2E ROUNDTRIP SUITE PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5ca3cedeb538a1e1ed4d8f4a22e722c0b33a19645b770495beb5378ba62382fb; exit=0; EXPECT=matched; output-sha256=fd7b1401d2544534a34a52dc9fafc171b22112ffc0957dd01f356853963b549d; output-bytes=183; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G2: the backend suite is green on the remote host
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/suite.mjs backend
  EXPECT: BACKEND SUITE PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c35b6964248bcbeb48fc6e4f89707e03996fd821a4b832b6439a84c6c10cb8c4; exit=0; EXPECT=matched; output-sha256=87a41dac8175b835ef8ea278c03f802d8df29e611ba62e7c43c83202e28a7002; output-bytes=179; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G3: FXA_REQUIRED is a real config key that is enforced, and only then
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/fxa-required.mjs
  EXPECT: FXA REQUIRED BEHAVIOUR VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=581fa7c93a10a10d525ac4182c1f172e2ff1fc64b32d6ef5fca3c313dabc565f; exit=0; EXPECT=matched; output-sha256=34bfc1feaf4fe67a2315234ef495da10c116d6a4bb47541a9fd2fd41607bec7f; output-bytes=348; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G4: an oversized websocket upload is answered 413, not 500
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/ws-limit-status.mjs
  EXPECT: WS LIMIT STATUS VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=d75585c335adf79fcb1c35d552e6f1821ae24b0377e23521ef6c88f19ad034dd; exit=0; EXPECT=matched; output-sha256=efee5b61411146692e3a0db1818421fd6e6f8e0a2de6c7d7932601a01731ace3; output-bytes=944; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G5: deleting storage never produces an unhandled rejection
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/delete-no-unhandled.mjs
  EXPECT: STORAGE DELETE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=4df5bf3f19280f713cefa407cccd8beae367529bc3443d72fb963010b3e193f6; exit=0; EXPECT=matched; output-sha256=918e896bab604f4bc73ca6cd1d8fae4ef37b60a43fdd20d26c8fa339e75c2fb6; output-bytes=313; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G6: no request writes to stdout from the server request path
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/no-request-stdout.mjs
  EXPECT: NO REQUEST STDOUT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f663a2ed8350682ed0d120b93eb6e8bf0d54573e5475c5cad115921afec02f95; exit=0; EXPECT=matched; output-sha256=088c433db752576d6224024b6845d69b6168d3775ae6d403ab40c0bbd99b48f8; output-bytes=285; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G7: a page request performs no Redis or storage work
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/page-no-storage.mjs
  EXPECT: PAGE REQUEST STORAGE-FREE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c338b08c4d39f897724959e988583a49e64b26b0b048fc407f22244537c32883; exit=0; EXPECT=matched; output-sha256=77572cb0173f9202931d9fa022f260d8774b79f910d991d36c9a31a4747ec90a; output-bytes=277; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G8: static assets are served compressed, and compression shrinks them
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/compression.mjs
  EXPECT: COMPRESSION VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f0385326cbe15249499bebe52ce94323849c1b85487da0d0ce2bc8fc5c1523dc; exit=0; EXPECT=matched; output-sha256=1fce8876c01f80d27555d5daebe86826a46bb69346be9dfa4a4a3af0a6b6a2c6; output-bytes=402; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G9: content-hashed assets are immutable and unhashed assets are not
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/cache-policy.mjs
  EXPECT: CACHE POLICY VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=414b0d323b2c3cfe9c2a5321cb07ef84fea39493e6f001f9114ad5351b8e9b77; exit=0; EXPECT=matched; output-sha256=d94e0df06a8dd2f2309e0e30a9b1d30887a2ee4d942b9e883feaccd6493ad84a; output-bytes=304; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G10: a download resolves its metadata in one Redis read and re-reads nothing
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/download-roundtrips.mjs
  EXPECT: DOWNLOAD ROUNDTRIP COUNT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=dfdbf1aec2168d80f021b8419a44ba5cb17a76becb9f9140e5654250a5597da7; exit=0; EXPECT=matched; output-sha256=ea6b7d316532d9ebd3891c5bf05c31cf21a92ef339495af929cb86052b1bd1f4; output-bytes=498; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G11: repeated page renders cost no additional choo serialisation
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/render-memo.mjs
  EXPECT: RENDER MEMOISATION VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=04049cc12cd2f750a79d08e5d034df30ea15da40d50f0da1e1428df572dae4df; exit=0; EXPECT=matched; output-sha256=930c41c7a2be827e35878051b2138362ea6925da7413c653b9d47c5df008726e; output-bytes=338; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G12: page render CPU per request stays inside a measured budget
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/render-budget.mjs
  EXPECT: RENDER BUDGET VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=df9d5a63ae4c652ea4875c8c280c06ae4dcdd2747399baf502c94f523bfee825; exit=0; EXPECT=matched; output-sha256=05393535a9763855bf5421185a163293fdfc84869b02a410aeb970ef71017233; output-bytes=294; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries
- [x] G13: the hosted instance completes a full user flow over the public internet
  CHECK: node scripts/verify/public-flow.mjs https://send.thevinod.lol
  EXPECT: PUBLIC USER FLOW VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=85025076a46864061f6b3f93a13fb2c6cce01f5c0fb1b4d9d1f835bacd6c0d69; exit=0; EXPECT=matched; output-sha256=c920ca72de82efd75daf5e333c8891d99db8186e857e379aae896d15874e929f; output-bytes=541; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G14: the hosted service restarts on its own and survives a reboot
  CHECK: SEND_UNIT=send-ultra SEND_HEALTH_URL=http://127.0.0.1:18100/ node scripts/verify/remote-run.mjs node scripts/verify/deploy-health.mjs
  EXPECT: DEPLOYED SERVICE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ef0b4de8567e70a615bcb136383ff57202fe9c6060cf25cd889838cbdf1250c5; exit=0; EXPECT=matched; output-sha256=b55d23281786ae862073b2707b0a0da47869ba66d663adb4e477a2cc75a67b37; output-bytes=270; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; path=e53232291def/33 entries

- [x] G15: every redesigned surface renders the Send Ultra shell, with no legacy light panel left behind
  CHECK: node scripts/verify/ui-surfaces.mjs https://send.thevinod.lol
  EXPECT: UI SURFACES VERIFIED
  EVIDENCE: automatic-evidence=v1; exit=0; EXPECT=matched; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; origin=http://23.23.142.61; surfaces=upload,post-upload-dialog,receiver,complete,error,expired,unsupported; checks-passed=78; browser-checks=sha256-match,qr-toggle-both-ways; bento-check=stage-and-rail-both-rows; negative-tests=inert-qr-toggle-fails,-legacy-blue-fails; note=also-verified-on-Chrome-131-via-SEND_CHROME_PATH

- [x] G16: the product name in user-facing copy follows the configured brand in every shipped language
  CHECK: node scripts/verify/brand-in-locales.mjs
  EXPECT: BRAND IN LOCALES VERIFIED
  EVIDENCE: automatic-evidence=v1; exit=0; EXPECT=matched; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; brand=Send Ultra; short-brand=Send; locales-checked=86; negative-test=fails-exit-1-when-rewrite-removed

## Known gaps

Deliberately not closed here. Recorded so they are visible in the repository
rather than only in a conversation.

- **The deployment serves plain HTTP.** The encrypted transfer is end-to-end, so
  the file contents and the secret in the link fragment are protected either
  way, but a link can be intercepted in transit and replayed, and a downgrade
  is possible. Needs a certificate or a tunnel, and therefore a hostname.
  G13 exercises the public flow over HTTP and cannot detect this.
- ~~**Filesystem storage never deletes expired ciphertext.**~~ Closed by G18 and
  `send-ultra-reap.timer`. Expiry was previously enforced on read only, so an
  expired link could not be used but the bytes stayed on disk until an operator
  swept them by hand. The reaper now runs daily and removes ciphertext that is
  both past `max_expire_seconds` and absent from Redis, so a live or in-flight
  upload cannot be collected.

- [x] G17: the transfer readout shows an honest time remaining, and hides itself until it can be trusted
  CHECK: node scripts/verify/transfer-readout.mjs https://send.thevinod.lol
  EXPECT: TRANSFER READOUT VERIFIED
  EVIDENCE: automatic-evidence=v1; exit=0; EXPECT=matched; shell=/bin/sh; cwd=/Users/saiduttaabhishekdash/send-ultra; origin=https://send.thevinod.lol; browser=Chrome-131-via-SEND_CHROME_PATH; payload=96MiB; checks=withheld-until-warm,percent,time-remaining,throughput,no-placeholder,advances-over-time,completes,no-leftover-countdown,no-page-errors; observed=2m37s-left-at-1.4MB/s; negative-tests=wrong-timestamp-argument-caught,entity-rendering-caught; unit-tests=frontend-39-passing

- [x] G18: expired ciphertext is deleted from disk, and in-flight uploads are never touched
  CHECK: node scripts/verify/remote-run.mjs node scripts/verify/reaper.mjs
  EXPECT: REAPER VERIFIED
  EVIDENCE: automatic-evidence=v1; exit=0; EXPECT=matched; shell=/bin/zsh; cwd=/Users/saiduttaabhishekdash/send-ultra; host=tejes@pelican; redis=127.0.0.1:6399-real-not-mock; fixture-dir=/tmp/reap-Ug9vTK; checks=expired-file-removed,old-file-with-live-key-kept,in-flight-upload-kept,recent-file-kept,second-old-file-with-live-key-kept,malformed-name-ignored,second-pass-noop; observed=6-entries-1-removed-4-kept-0-errors; production-run=scanned-32-entries-0-removed-32-kept-age-threshold-608400s; schedule=send-ultra-reap.timer-OnCalendar-*-*-*-04:17:00-RandomizedDelaySec-45m-Persistent-true; systemd-Result=success
