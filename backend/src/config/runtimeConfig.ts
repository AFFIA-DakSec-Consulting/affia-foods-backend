/**
 * Boot-time configuration check. Pure (takes the env as an argument) so it can be tested.
 * Hard requirements stop the server from starting; soft ones are returned as warnings.
 * Runs whenever NODE_ENV is not 'test' (a staging box or a mistyped NODE_ENV must not start with an empty JWT secret).
 *
 * Payments: `PAYMENT_PROVIDER=simulated` (explicit opt-in) needs no provider keys: every payment succeeds instantly and nobody is
 * charged. It is refused when NODE_ENV=production unless ALLOW_SIMULATED_PAYMENTS=true, so a real deployment cannot go live by accident
 * with free orders. Any other value (or none) means the Razorpay adapter, which needs its three keys.
 */
export const BASE_CONFIG = ['JWT_SECRET', 'DATABASE_URL', 'ADMIN_PASSCODE'] as const;
export const PROVIDER_CONFIG = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const;
export const REQUIRED_CONFIG = [...BASE_CONFIG, ...PROVIDER_CONFIG] as const;
export const RECOMMENDED_CONFIG = ['GOOGLE_WEB_CLIENT_ID'] as const;

export const assertRuntimeConfig = (env: Record<string, string | undefined>): { warnings: string[] } => {
  const blank = (k: string) => !env[k] || !String(env[k]).trim();
  const simulated = env.PAYMENT_PROVIDER === 'simulated';
  const missing = (simulated ? BASE_CONFIG : REQUIRED_CONFIG).filter(blank);
  if (missing.length > 0) throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  if (simulated && env.NODE_ENV === 'production' && env.ALLOW_SIMULATED_PAYMENTS !== 'true') {
    throw new Error('PAYMENT_PROVIDER=simulated is not allowed with NODE_ENV=production: every order would be free. Set ALLOW_SIMULATED_PAYMENTS=true to override.');
  }
  const warnings: string[] = [];
  if (simulated) warnings.push('Payments are SIMULATED (PAYMENT_PROVIDER=simulated): every payment succeeds instantly and nobody is charged.');
  for (const key of RECOMMENDED_CONFIG) {
    if (blank(key)) warnings.push(`${key} is not set: customer Google sign-in will answer 503 until it is configured.`);
  }
  return { warnings };
};
