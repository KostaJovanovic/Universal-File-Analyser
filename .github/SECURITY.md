# Security Policy

Analyser is a static, browser-only site: it has no backend, no accounts and no
database of user data, and it uploads nothing. That removes most of the usual
attack surface, but the app still parses untrusted files on the visitor's
device, so parsing and rendering bugs matter.

## What is in scope

- Any way a crafted file could run script, read data outside the page, or
  otherwise escape the sandbox when analysed (XSS, prototype pollution, unsafe
  `innerHTML`, SVG/HTML injection from file contents, etc.).
- Any code path that would cause a file's bytes or name to leave the device.
  The no-upload promise is the core of the project; a violation is a serious
  bug.
- Issues in the one small Cloudflare Worker that backs the anonymous
  visit/analysed counters (`worker/`).

## What is out of scope

- Denial of service from deliberately huge or malformed files (the tool runs on
  your own device; a hang costs you a tab).
- Missing security headers that do not lead to a concrete exploit.
- Reports from automated scanners with no demonstrated impact.

## Reporting

Please report privately - do **not** open a public issue for a vulnerability.

Preferred: use GitHub's **private vulnerability reporting** (the "Report a
vulnerability" button under the Security tab), if enabled.

Otherwise email **valjdakosta@gmail.com** with:

- what the issue is and where in the code,
- steps or a sample file to reproduce it,
- the impact you believe it has.

This is a solo hobby project, so there is no formal SLA and no bug-bounty
programme, but genuine reports are taken seriously and I will do my best to
acknowledge within a few days and credit you when a fix ships, if you would
like.
