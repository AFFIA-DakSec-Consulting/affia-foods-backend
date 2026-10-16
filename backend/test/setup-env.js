// The local .env opts into simulated payments (PAYMENT_PROVIDER=simulated). Tests must not inherit that: they run the
// real code path (Razorpay adapter replaced by the in-memory simulator by NODE_ENV=test). dotenv never overrides a variable
// that is already set, so setting it here wins. The tests of the simulated mode switch it on themselves.
process.env.PAYMENT_PROVIDER = 'razorpay';
// The payment tests sign and verify with these (the local .env no longer carries provider keys).
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'placeholder';
// The suites sign tokens and webhooks with these values; a developer's local .env carries its own secrets and must not leak in
// (dotenv never overrides a variable that is already set, so setting them here wins).
process.env.JWT_SECRET = 'kraveo_vit_bhopal_super_secret_jwt_key_2026';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
// Node 20 keeps HTTP connections open by default. Every supertest request starts its own throw-away server on a random port, and a kept-alive
// connection can be handed to a NEW server that got the same port number: the symptoms are a random 404/403 or "Parse Error: Expected HTTP/".
// One connection per request makes the suites deterministic.
const http = require('http');
const https = require('https');
http.globalAgent = new http.Agent({ keepAlive: false });
https.globalAgent = new https.Agent({ keepAlive: false });
