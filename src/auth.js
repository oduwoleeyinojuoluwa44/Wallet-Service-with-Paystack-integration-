const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { config } = require('./config');
const store = require('./store');

const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

function issueJwt(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: '7d',
  });
}

async function verifyGoogleIdToken(idToken) {
  if (!googleClient) {
    throw new Error('Google auth is not configured');
  }
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: config.googleClientId,
  });
  return ticket.getPayload();
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const apiKeyHeader = req.headers['x-api-key'] || '';

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = await store.getUserById(payload.sub);
      if (!user) {
        return res.status(401).json({ error: 'User not found for token' });
      }
      req.auth = { type: 'user', user };
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  if (apiKeyHeader) {
    const apiKeyRecord = await store.findApiKey(apiKeyHeader);
    if (!apiKeyRecord) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (apiKeyRecord.revoked) {
      return res.status(403).json({ error: 'API key revoked' });
    }
    if (new Date(apiKeyRecord.expiresAt) <= new Date()) {
      return res.status(401).json({ error: 'API key expired' });
    }
    const user = await store.getUserById(apiKeyRecord.userId);
    if (!user) {
      return res.status(401).json({ error: 'User missing for API key' });
    }
    req.auth = { type: 'apiKey', key: apiKeyRecord, user };
    return next();
  }

  return res.status(401).json({ error: 'Authentication required' });
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.auth?.type === 'apiKey') {
      if (!req.auth.key.permissions.includes(permission)) {
        return res.status(403).json({ error: `Missing ${permission} permission` });
      }
    }
    return next();
  };
}

function requireUserAuth(req, res, next) {
  if (req.auth?.type !== 'user') {
    return res.status(403).json({ error: 'JWT user required for this action' });
  }
  return next();
}

module.exports = {
  authenticate,
  requirePermission,
  requireUserAuth,
  issueJwt,
  verifyGoogleIdToken,
};
