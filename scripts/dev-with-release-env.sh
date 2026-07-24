#!/bin/bash
export NODE_ENV=development
export DATABASE_URL='mysql://root:root@127.0.0.1:3306/dayforge_release'
export STRIPE_SECRET_KEY='sk_test_placeholder_for_local_release_gate_only'
export DAYFORGE_PUBLIC_PREVIEW_TOKEN_SECRET='local_release_gate_token_secret_0123456789'
export DAYFORGE_PUBLIC_PREVIEW_FINGERPRINT_SECRET='local_release_gate_fingerprint_secret_abcdef'
export DAYFORGE_RELEASE_TEST_MODE=1
export ADMIN_PASSWORD='local-visual-check-only'
export JWT_SECRET='local_visual_check_jwt_secret_0123456789ab'
export APP_SHARED_API_SECRET='local_visual_check_shared_secret_0123456789ab'
exec pnpm exec tsx watch server/_core/index.ts
