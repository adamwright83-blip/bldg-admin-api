/* LEGACY DAYFORGE COMPATIBILITY: retained historical database, route and environment literals only; canonical product is JOYSTICK. */
import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise';

// Explicit disposable destination; never inherit the application's .env database.
const databaseUrl = process.env.JOYSTICK_ACCEPTANCE_DATABASE_URL;
if (!databaseUrl) throw new Error('Set JOYSTICK_ACCEPTANCE_DATABASE_URL to disposable MySQL');
const destination = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(destination.hostname) || destination.pathname !== '/joystick_real_acceptance') {
  throw new Error('Acceptance requires localhost /joystick_real_acceptance');
}
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME,
  CI: process.env.CI ?? '',
  NODE_ENV: 'test', ALLOW_TEST_DB: '1', DOTENV_CONFIG_PATH: '/dev/null',
  DATABASE_URL: databaseUrl, JOYSTICK_ACCEPTANCE_DATABASE_URL: databaseUrl,
  APP_SHARED_API_SECRET: 'acceptance-app-secret-000000000000000000',
  JWT_SECRET: 'acceptance-jwt-secret-000000000000000000',
  STRIPE_SECRET_KEY: 'acceptance-placeholder-not-used',
  DAYFORGE_BILLING_STRIPE_SECRET_KEY: 'sk_test_acceptance_placeholder_not_used',
  DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET: 'whsec_acceptance_placeholder',
  DRIVER_PASSWORD: 'acceptance-driver', DRIVER_OPEN_ID: 'acceptance-driver', ADMIN_PASSWORD: 'acceptance-admin',
  VITE_DAYFORGE_DEMO_MODE: 'false', PORT: '4186',
};
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)));
  });
}
const rootUrl = new URL(databaseUrl); rootUrl.pathname = '/';
const db = await mysql.createConnection(rootUrl.toString());
try {
  await db.query('DROP DATABASE IF EXISTS joystick_real_acceptance');
  await db.query('CREATE DATABASE joystick_real_acceptance');
  await run('node', ['scripts/migrate.mjs']);
  await run('node', ['scripts/acceptance-schema-compat.mjs']);
  await run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.real.config.ts']);
  await run('pnpm', ['exec', 'esbuild', 'server/_core/index.ts', '--platform=node', '--packages=external', '--bundle', '--format=esm', '--outfile=dist/index.js']);
  await run('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.real.config.ts', ...process.argv.slice(2)]);
} finally {
  await db.query('DROP DATABASE IF EXISTS joystick_real_acceptance');
  await db.end();
}
