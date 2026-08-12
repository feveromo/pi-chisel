# Security policy

## Supported versions

Security fixes are provided for the current native Pi release and the latest OMP integration on `main`. The verified compatibility boundaries are Pi `0.84.1` and OMP `17.2.11`.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/feveromo/pi-chisel/security/advisories/new). Do not include credentials, private prompts, or other sensitive user data in a public issue.

Include the affected version, impact, reproduction steps, and any suggested mitigation. You should receive an acknowledgement within seven days.

## Data boundary

Chisel sends the unsent draft and, unless context mode is `none`, bounded workspace and session evidence to the selected model provider. It does not persist that request or add it to OMP's session transcript. See [Privacy and data handling](README.md#privacy-and-data-handling) for the complete user-facing behavior.
