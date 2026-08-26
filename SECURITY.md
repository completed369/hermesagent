# Security policy

## Reporting a vulnerability

Do not disclose a suspected vulnerability, credential, personal data, exploit,
or sensitive infrastructure detail in a public issue, pull request, discussion,
or commit.

Use GitHub's private vulnerability-reporting form from this repository's
**Security** tab when it is available. If that form is unavailable, contact the
repository owner through a previously verified private channel and include only
the minimum information needed to establish a secure follow-up channel.

Please include:

- the affected component and source revision;
- a concise impact statement and reproduction steps;
- whether tenant isolation, authentication, authorization, secrets, data loss,
  provider execution, or spending may be affected; and
- any safe mitigation you have already identified.

Do not access another tenant, use real customer data, publish an exploit, incur
cost, activate a provider, or test against production without explicit written
authorization. Acknowledgement and remediation timelines depend on severity and
maintainer availability; this policy does not promise a bounty or fixed SLA.

## Supported versions

VentureOS is under active private development and has no declared public
production release or supported-version matrix. Security fixes target the
current maintained development line unless the repository owner states
otherwise.

For the implemented controls and known gaps, see
[`docs/SECURITY.md`](docs/SECURITY.md),
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md), and
[`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).
