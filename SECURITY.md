# Security policy

## Supported versions

Security fixes are provided for the current native Pi release and the latest OMP integration on `main`. The verified compatibility boundaries are Pi `0.87.1` and OMP `18.4.0`.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/feveromo/pi-chisel/security/advisories/new). Do not include credentials, private prompts, or other sensitive user data in a public issue.

Include the affected version, impact, reproduction steps, and any suggested mitigation. You should receive an acknowledgement within seven days.

## Data boundary

Chisel sends the unsent draft and, unless context mode is `none`, selected bounded workspace/session evidence to the chosen model provider. Tool excerpts require explicit selection; they are never enabled by a persistent setting. Revisions also send the current candidate and user editing feedback. None of this request/revision data is persisted by Chisel or added to either host's session transcript.

Use pre-send inspection (`inspectContext` or `/chisel-context`) to review/exclude evidence before the first transmission. Review-time exclusions apply only to subsequent requests and cannot undo earlier disclosure. The tool allowlist and credential-target filter are not exhaustive secret detection; inspect any selected excerpts. Source inclusion is not verification, and untrusted evidence is never authorized to control the optimizer or execute tools.

See [Privacy and safety](README.md#privacy-and-safety) and [context inspection](README.md#see-what-gets-sent) for provider retention, opt-in, and UI behavior.
