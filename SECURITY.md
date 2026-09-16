# Security Policy

## Reporting a vulnerability

Never include credentials, tokens, private URLs, authentication headers, response bodies, or other sensitive data in a public issue.

Report vulnerabilities privately through GitHub's **Security** tab and the **Report a vulnerability** option when available. If private vulnerability reporting is unavailable, contact the maintainer privately through the contact method on the maintainer's GitHub profile before sharing details.

Include the affected version, expected impact, and minimal reproduction steps without real credentials.

## Authentication headers

Store authentication values in GitHub Secrets and pass them through `headers-json`. Do not place literal credentials in workflow files. The same headers are sent to both benchmark targets, so ensure each target is authorized to receive them.
