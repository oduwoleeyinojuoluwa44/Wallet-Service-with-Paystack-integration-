const express = require('express');
const path = require('path');
const { config } = require('./config');
const {
  authenticate,
  requirePermission,
  requireUserAuth,
  issueJwt,
  verifyGoogleIdToken,
} = require('./auth');
const store = require('./store');
const { initializeDeposit, verifySignature } = require('./paystack');
const { initDb } = require('./db');
const { apiSpec } = require('./openapi');
const swaggerUi = require('swagger-ui-express');

const app = express();

// Use raw body for Paystack webhook so we can verify the signature.
app.post(
  '/wallet/paystack/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.body;

    if (!verifySignature(rawBody, signature)) {
      return res.status(400).json({ error: 'Invalid Paystack signature' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      return res.status(400).json({ error: 'Invalid webhook JSON' });
    }

    const reference = payload?.data?.reference;
    if (!reference) {
      return res.status(400).json({ error: 'Missing transaction reference' });
    }

    const tx = await store.findTransactionByReference(reference);
    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (tx.status === 'success') {
      return res.json({ status: true, message: 'Already processed' });
    }

    if (payload?.data?.status !== 'success') {
      await store.updateTransaction(reference, {
        status: 'failed',
        webhookEvent: payload.event,
      });
      return res.json({ status: true });
    }

    const amountFromWebhook = Math.round((payload?.data?.amount || 0) / 100);
    const creditAmount = amountFromWebhook || tx.amount || 0;

    await store.updateTransaction(reference, {
      status: 'success',
      amount: tx.amount || creditAmount,
      webhookEvent: payload.event,
      gatewayResponse: payload?.data?.gateway_response,
    });
    await store.adjustWalletBalance(tx.userId, creditAmount);

    return res.json({ status: true });
  },
);

// JSON middleware for normal routes.
app.use(express.json());
// Serve the demo frontend.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Public config for the frontend (only non-sensitive values).
app.get('/config/public', (req, res) => {
  res.json({
    googleClientId: config.googleClientId || null,
  });
});

// Swagger/OpenAPI docs
function buildSpec(req) {
  const hostUrl = `${req.protocol}://${req.get('host')}`;
  return { ...apiSpec, servers: [{ url: hostUrl }] };
}

app.get('/openapi.json', (req, res) => res.json(buildSpec(req)));
app.use('/docs', swaggerUi.serve, (req, res, next) => {
  const hostUrl = `${req.protocol}://${req.get('host')}`;
  const swaggerOpts = {
    swaggerUrl: '/openapi.json',
    explorer: false,
    oauth: {
      redirectUrl: `${hostUrl}/docs/oauth2-redirect.html`,
    },
  };
  return swaggerUi.setup(null, swaggerOpts)(req, res, next);
});

function generateReference(prefix) {
  // Keep trying until unique in DB
  const randRef = () => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return (async function loop() {
    const ref = randRef();
    const existing = await store.findTransactionByReference(ref);
    if (!existing) return ref;
    return loop();
  })();
}

function parseExpiryToDate(expiry) {
  if (!expiry || typeof expiry !== 'string') return null;
  const normalized = expiry.trim().toUpperCase();
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  switch (normalized) {
    case '1H':
      return new Date(now + hour);
    case '1D':
      return new Date(now + 24 * hour);
    case '1M':
      return new Date(now + 30 * 24 * hour);
    case '1Y':
      return new Date(now + 365 * 24 * hour);
    default:
      return null;
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/auth/google', (req, res) => {
  if (!config.googleClientId && !config.allowInsecureGoogleMock) {
    return res.status(400).json({ error: 'Google auth not configured' });
  }
  const redirectUri =
    config.googleRedirectUri ||
    `${req.protocol}://${req.get('host')}/auth/google/callback`;
  const authUrl = config.googleClientId
    ? `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
        config.googleClientId,
      )}&redirect_uri=${encodeURIComponent(
        redirectUri,
      )}&response_type=token&scope=openid%20email%20profile`
    : null;

  return res.json({
    auth_url: authUrl,
    redirect_uri: redirectUri,
    note: config.allowInsecureGoogleMock
      ? 'Dev mock enabled: call /auth/google/callback?email=you@example.com'
      : undefined,
  });
});

app.get('/auth/google/callback', async (req, res) => {
  const idToken = req.query.id_token || req.query.token;
  const mockEmail = req.query.email;
  let payload;

  try {
    if (idToken) {
      payload = await verifyGoogleIdToken(idToken);
    } else if (config.allowInsecureGoogleMock && mockEmail) {
      payload = { email: mockEmail, name: req.query.name || mockEmail };
    } else {
      return res.status(400).json({ error: 'id_token is required' });
    }
  } catch (err) {
    if (config.allowInsecureGoogleMock && mockEmail) {
      payload = { email: mockEmail, name: req.query.name || mockEmail };
    } else {
      return res.status(401).json({ error: 'Invalid Google token', detail: err.message });
    }
  }

  const user = await store.createUser({
    email: payload.email,
    name: payload.name,
    googleId: payload.sub,
  });
  const wallet = await store.ensureWallet(user.id);
  const token = issueJwt(user);
  return res.json({ token, user, wallet });
});

app.post('/keys/create', authenticate, requireUserAuth, async (req, res) => {
  const { name, permissions, expiry } = req.body;
  if (!name || !Array.isArray(permissions) || !permissions.length || !expiry) {
    return res.status(400).json({ error: 'name, permissions, and expiry are required' });
  }

  const normalizedPermissions = [...new Set(permissions.map((p) => p.toLowerCase()))];
  const validPermissions = normalizedPermissions.filter((p) =>
    store.permittedPermissions.includes(p),
  );
  if (!validPermissions.length) {
    return res.status(400).json({ error: 'No valid permissions supplied' });
  }

  const expiresAt = parseExpiryToDate(expiry);
  if (!expiresAt) {
    return res.status(400).json({ error: 'Invalid expiry. Use 1H, 1D, 1M, or 1Y' });
  }

  const activeKeys = await store.listActiveApiKeysForUser(req.auth.user.id);
  if (activeKeys.length >= 5) {
    return res
      .status(400)
      .json({ error: 'Maximum of 5 active API keys reached. Revoke or let one expire.' });
  }

  const keyRecord = await store.createApiKey(req.auth.user.id, {
    name,
    permissions: validPermissions,
    expiresAt,
  });

  return res.json({
    api_key: keyRecord.key,
    id: keyRecord.id,
    permissions: keyRecord.permissions,
    expires_at: keyRecord.expiresAt,
  });
});

app.post('/keys/rollover', authenticate, requireUserAuth, async (req, res) => {
  const { expired_key_id: expiredKeyId, expiry } = req.body;
  if (!expiredKeyId || !expiry) {
    return res.status(400).json({ error: 'expired_key_id and expiry are required' });
  }

  const oldKey = await store.findApiKeyById(expiredKeyId);
  if (!oldKey || oldKey.userId !== req.auth.user.id) {
    return res.status(404).json({ error: 'Expired key not found for this user' });
  }

  const isExpired = new Date(oldKey.expiresAt) <= new Date();
  if (!isExpired) {
    return res.status(400).json({ error: 'Key is not expired yet' });
  }

  const expiresAt = parseExpiryToDate(expiry);
  if (!expiresAt) {
    return res.status(400).json({ error: 'Invalid expiry. Use 1H, 1D, 1M, or 1Y' });
  }

  const activeKeys = await store.listActiveApiKeysForUser(req.auth.user.id);
  if (activeKeys.length >= 5) {
    return res
      .status(400)
      .json({ error: 'Maximum of 5 active API keys reached. Revoke or let one expire.' });
  }

  const newKey = await store.createApiKey(req.auth.user.id, {
    name: oldKey.name,
    permissions: oldKey.permissions,
    expiresAt,
  });

  return res.json({
    api_key: newKey.key,
    id: newKey.id,
    permissions: newKey.permissions,
    expires_at: newKey.expiresAt,
  });
});

app.post('/keys/revoke', authenticate, requireUserAuth, async (req, res) => {
  const { api_key: apiKeyValue } = req.body;
  if (!apiKeyValue) {
    return res.status(400).json({ error: 'api_key is required' });
  }
  const record = await store.findApiKey(apiKeyValue);
  if (!record || record.userId !== req.auth.user.id) {
    return res.status(404).json({ error: 'API key not found for this user' });
  }
  if (record.revoked) {
    return res.json({ status: 'already_revoked', id: record.id });
  }
  await store.updateApiKey(record.id, { revoked: true });
  return res.json({ status: 'revoked', id: record.id });
});

app.post(
  '/wallet/deposit',
  authenticate,
  requirePermission('deposit'),
  async (req, res) => {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const reference = await generateReference('dep');
    const user = req.auth.user;

    await store.createTransaction({
      reference,
      type: 'deposit',
      userId: user.id,
      amount,
      status: 'pending',
      source: 'paystack',
    });

    try {
      const response = await initializeDeposit({
        amount,
        email: user.email,
        reference,
      });
      return res.json({
        reference,
        authorization_url: response.authorization_url,
      });
    } catch (err) {
      await store.updateTransaction(reference, { status: 'failed', error: err.message });
      return res.status(502).json({ error: 'Failed to initialize Paystack deposit' });
    }
  },
);

app.get(
  '/wallet/deposit/:reference/status',
  authenticate,
  requirePermission('read'),
  async (req, res) => {
    const tx = await store.findTransactionByReference(req.params.reference);
    if (!tx || tx.type !== 'deposit') {
      return res.status(404).json({ error: 'Deposit not found' });
    }
    if (tx.userId !== req.auth.user.id) {
      return res.status(403).json({ error: 'Not allowed to view this deposit' });
    }
    return res.json({
      reference: tx.reference,
      status: tx.status,
      amount: tx.amount,
    });
  },
);

app.get('/wallet/balance', authenticate, requirePermission('read'), async (req, res) => {
  const wallet = await store.ensureWallet(req.auth.user.id);
  return res.json({ balance: wallet.balance, wallet_number: wallet.walletNumber });
});

app.post(
  '/wallet/transfer',
  authenticate,
  requirePermission('transfer'),
  async (req, res) => {
    const { wallet_number: walletNumber, amount } = req.body;
    const transferAmount = Number(amount);
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const senderWallet = await store.ensureWallet(req.auth.user.id);
    if (senderWallet.balance < transferAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const receiverWallet = await store.findWalletByNumber(walletNumber);
    if (!receiverWallet) {
      return res.status(404).json({ error: 'Recipient wallet not found' });
    }

    if (receiverWallet.userId === req.auth.user.id) {
      return res.status(400).json({ error: 'Cannot transfer to your own wallet' });
    }

    await store.adjustWalletBalance(req.auth.user.id, -transferAmount);
    await store.adjustWalletBalance(receiverWallet.userId, transferAmount);

    const reference = await generateReference('trf');
    await store.createTransaction({
      reference,
      type: 'transfer',
      fromUserId: req.auth.user.id,
      toUserId: receiverWallet.userId,
      amount: transferAmount,
      status: 'success',
    });

    return res.json({
      status: 'success',
      message: 'Transfer completed',
      reference,
    });
  },
);

app.get(
  '/wallet/transactions',
  authenticate,
  requirePermission('read'),
  async (req, res) => {
    const txs = await store.listTransactionsForUser(req.auth.user.id);
    const entries = txs.map((tx) => {
      const direction =
        tx.type === 'transfer'
          ? tx.fromUserId === req.auth.user.id
            ? 'debit'
            : 'credit'
          : 'credit';
      return {
        reference: tx.reference,
        type: tx.type,
        amount: tx.amount,
        status: tx.status,
        direction,
        created_at: tx.createdAt || tx.updatedAt,
      };
    });
    return res.json(entries);
  },
);

const port = config.port || 3000;
initDb()
  .then(() => {
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Wallet service listening on port ${port}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
