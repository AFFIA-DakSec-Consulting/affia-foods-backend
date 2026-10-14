// The local .env opts into simulated payments (PAYMENT_PROVIDER=simulated). Tests must not inherit that: they run the
// real code path (Razorpay adapter replaced by the in-memory simulator by NODE_ENV=test). dotenv never overrides a variable
// that is already set, so setting it here wins. The tests of the simulated mode switch it on themselves.
process.env.PAYMENT_PROVIDER = 'razorpay';
// The payment tests sign and verify with these (the local .env no longer carries provider keys).
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'placeholder';
