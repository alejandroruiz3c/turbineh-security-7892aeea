# Contributing

Use a short-lived branch and a pull request. Describe the problem, the change,
the validation performed and any deployment implications. Keep changes focused;
do not combine repository maintenance with production data changes.

Use the package manager and lockfile already committed to this repository.
Run documented checks before requesting review. Report checks that could not run
as unverified; an absent test suite is not a passing test suite.

Use synthetic data and development credentials. Keep tenant/customer information,
secrets and generated reports out of commits. Never rewrite published history
without a separately agreed migration plan. Preserve connected deployment tools.

Changes to authentication, payments, ownership checks or data access need targeted
regression tests and review before release. Do not use production transactions,
customer emails or live infrastructure as an automated smoke test.
