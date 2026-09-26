# Security

This repository is private. Share suspected vulnerabilities with the repository
owner through an existing private channel. Do not publish credentials, customer
data, raw environment files or exploitable details in a public issue.

Include the affected revision, component, impact and a minimal reproduction using
synthetic data. Do not access other tenants or exercise real payments to prove a bug.

## Credentials

Only placeholder examples belong in version control. Keep real credentials in the
deployment platform's secret store or an ignored local environment file.
Removing a secret from the current tree does not remove it from Git history.
If a credential was committed, assess exposure and revoke/rotate it at its issuer;
coordinate dependent services to avoid interruption. Rotate encryption keys only
with a data migration/recovery plan.

## Release checks

Verify authorization and isolation tests, dependency findings and deployment
configuration before release. Repository documentation alone is not evidence
that a deployed service is secure or that every vulnerability has been fixed.
