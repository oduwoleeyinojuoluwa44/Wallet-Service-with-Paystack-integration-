const axios = require('axios');
const crypto = require('crypto');
const { config } = require('./config');

async function initializeDeposit({ amount, email, reference }) {
  if (!config.paystackSecretKey || config.allowPaystackStub) {
    // Stubbed response for local development without Paystack keys.
    return {
      authorization_url: `https://paystack.test/checkout/${reference}`,
      reference,
      stubbed: true,
    };
  }

  const payload = {
    amount: Math.round(amount * 100),
    email,
    reference,
  };

  const response = await axios.post(
    `${config.paystackBaseUrl}/transaction/initialize`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${config.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.data?.data) {
    throw new Error('Unexpected Paystack response');
  }

  return response.data.data;
}

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  if (!config.paystackSecretKey) return config.allowPaystackStub;
  const hash = crypto
    .createHmac('sha512', config.paystackSecretKey)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}

module.exports = {
  initializeDeposit,
  verifySignature,
};
