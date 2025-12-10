const apiSpec = {
  openapi: '3.0.1',
  info: {
    title: 'Wallet Service API',
    version: '1.0.0',
    description:
      'Wallet service with Google JWT auth, API keys, Paystack deposits, webhook, transfers, and history.',
  },
  servers: [
    {
      url: '/',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
    schemas: {
      ApiError: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
  security: [],
  paths: {
    '/auth/google': {
      get: {
        summary: 'Get Google auth URL',
        responses: {
          200: {
            description: 'Auth URL',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/auth/google/callback': {
      get: {
        summary: 'Handle Google callback (id_token)',
        parameters: [
          {
            name: 'id_token',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'email',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'JWT issued' },
          401: { description: 'Invalid token', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        },
      },
    },
    '/keys/create': {
      post: {
        summary: 'Create API key',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'permissions', 'expiry'],
                properties: {
                  name: { type: 'string' },
                  permissions: { type: 'array', items: { type: 'string', enum: ['read', 'deposit', 'transfer'] } },
                  expiry: { type: 'string', enum: ['1H', '1D', '1M', '1Y'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'API key created' },
          400: { description: 'Validation error' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/keys/rollover': {
      post: {
        summary: 'Rollover expired key',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['expired_key_id', 'expiry'],
                properties: {
                  expired_key_id: { type: 'string' },
                  expiry: { type: 'string', enum: ['1H', '1D', '1M', '1Y'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'New key created' },
          400: { description: 'Key not expired or invalid' },
        },
      },
    },
    '/keys/revoke': {
      post: {
        summary: 'Revoke API key',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['api_key'],
                properties: { api_key: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Revoked' },
          404: { description: 'Not found' },
        },
      },
    },
    '/wallet/deposit': {
      post: {
        summary: 'Initialize Paystack deposit',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['amount'], properties: { amount: { type: 'number' } } },
            },
          },
        },
        responses: {
          200: { description: 'Deposit initialized' },
          400: { description: 'Validation error' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/wallet/paystack/webhook': {
      post: {
        summary: 'Paystack webhook (credits wallet on success)',
        responses: {
          200: { description: 'Processed' },
          400: { description: 'Invalid signature/payload' },
        },
      },
    },
    '/wallet/deposit/{reference}/status': {
      get: {
        summary: 'Get deposit status (read-only)',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [
          { name: 'reference', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Status' },
          404: { description: 'Not found' },
        },
      },
    },
    '/wallet/balance': {
      get: {
        summary: 'Get wallet balance',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          200: { description: 'Balance' },
        },
      },
    },
    '/wallet/transfer': {
      post: {
        summary: 'Transfer between wallets',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['wallet_number', 'amount'],
                properties: {
                  wallet_number: { type: 'string' },
                  amount: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Transfer success' },
          400: { description: 'Validation/insufficient funds' },
          404: { description: 'Recipient not found' },
        },
      },
    },
    '/wallet/transactions': {
      get: {
        summary: 'List transactions for user',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          200: { description: 'Transactions' },
        },
      },
    },
  },
};

module.exports = { apiSpec };
