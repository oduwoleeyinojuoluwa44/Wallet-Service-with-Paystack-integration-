const dotenv = require('dotenv');

// Load environment variables once at startup.
dotenv.config();

const config = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  paystackBaseUrl: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URL || '',
  allowPaystackStub: process.env.ALLOW_PAYSTACK_STUB === 'true',
  allowInsecureGoogleMock: process.env.ALLOW_INSECURE_GOOGLE_MOCK === 'true',
};

module.exports = { config };
