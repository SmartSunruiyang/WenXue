# Question solver assessment lab

This fixture is a local, answer-key-free assessment surface for exercising the generic adapter and the all-frame host without access to a live learning platform.

- `assessment-lab.html` is the top document and embeds the assessment in an iframe.
- `assessment-frame.html` contains a mixed text/image stem, a mixed text/image option, four image-only options without `alt`/`title`, a completion control, a hidden captcha that tests can reveal, and a decoy final-submit button.
- `fixtureServer.mjs` serves `cross-origin-top.html` and `cross-origin-frame.html` from distinct loopback origins; the top fixture also embeds a sandboxed opaque-origin `srcdoc` frame.
- `assets/` contains small local images so inline loading and bound screenshot fallback can be tested independently.

The fixture deliberately contains no correct-answer field. Tests choose synthetic answers explicitly, verify exact control state, and restore the original state. No test clicks the final-submit button.

To inspect it manually, serve `apps/extension/test-fixtures/question-solver` from any local static HTTP server and open `assessment-lab.html`.
