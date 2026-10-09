# Real JOYSTICK customer acceptance

Run against disposable MySQL 8 with the root account able to create and delete
`joystick_real_acceptance`:

```sh
docker run -d --name joystick-acceptance-mysql -e MYSQL_ROOT_PASSWORD=root -p 127.0.0.1:3418:3306 mysql:8.0
JOYSTICK_ACCEPTANCE_DATABASE_URL=mysql://root:root@127.0.0.1:3418/joystick_real_acceptance pnpm test:launch:real
docker rm -f joystick-acceptance-mysql
```

Wait for MySQL's health before the command. The runner requires an explicit
localhost destination with exactly that database name. It recreates the database,
runs repository migrations plus guarded existing historical DDL for currently omitted
schema (tracked in an approval-held production repair), builds the actual frontend/backend, and starts the
actual server on port 4186. A sanitized environment prevents application `.env`
credentials, outbound providers and production workers from entering this run.
`ALLOW_TEST_DB=1` enables the repository's existing test-mode database access;
authentication and authorization use the unmodified production implementations.
The entire database is deleted in `finally`, including a failing test run.

Owners are disposable persisted fixtures with bcrypt password hashes, active
memberships and entitlements. Their browser cookies come from the actual login
form and `/api/dayforge/auth/login`. World setup is deterministic persisted test
business data; field mutations, business reads and completion events execute
through real HTTP procedures. No business request is fulfilled with a mocked
response. The acquisition test begins anonymously through the public page.

The existing `e2e/launch` tests remain separate mocked UI regression coverage.
Placeholder Stripe keys only satisfy backend startup validation; no provider
payment acceptance is asserted by this suite.

Hosted execution is the `Real browser, backend, authentication and MySQL
acceptance` step of `.github/workflows/saas-launch-exam.yml`. Each test attaches
JSON database/procedure evidence and browser screenshots. Results and retained
failure traces are uploaded as `joystick-real-acceptance`; local results are in
`playwright-report/real` and `test-results/real-results.json`.
