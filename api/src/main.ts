import 'dotenv/config'
import * as crypto from 'crypto'
import { VersioningType, Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import * as firebase from 'firebase-admin'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import * as express from 'express'
import { NestExpressApplication } from '@nestjs/platform-express'

// Ensure crypto is available globally for @nestjs/schedule
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = crypto as any
}

// Global error handlers to prevent server crashes
const logger = new Logger('GlobalErrorHandler')

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error.stack || error.message)
  // Don't exit the process for uncaught exceptions in production
  // process.exit(1)
})

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

async function bootstrap() {
  const app: NestExpressApplication = await NestFactory.create(AppModule)
  app.set('trust proxy', true)
  const PORT = process.env.API_PORT || process.env.PORT || 3001

  // Normalize and deduplicate allowed origins
  const rawOrigins = [
    process.env.FRONTEND_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SERVICE_URL_TEXTBEE_WEB,
    process.env.SERVICE_FQDN_TEXTBEE_WEB ? `https://${process.env.SERVICE_FQDN_TEXTBEE_WEB}` : undefined,
    'https://textbee.arcofs.app' // Hardcoded fallback as clear user intent
  ];

  const allowedOrigins = [...new Set(
    rawOrigins
      .filter(Boolean)
      .map(s => s!.trim().replace(/\/$/, '')) // Trim whitespace and trailing slashes
  )];

  logger.log(`Configured CORS Allowed Origins: ${JSON.stringify(allowedOrigins)}`);

  app.setGlobalPrefix('api')
  app.enableVersioning({
    defaultVersion: '1',
    type: VersioningType.URI,
  })

  const config = new DocumentBuilder()
    .setTitle('TextBee API Docs')
    .setDescription('TextBee - Android SMS Gateway API Docs')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({
      type: 'apiKey',
      name: 'x-api-key',
      in: 'header',
    })
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  })

  // Debug Firebase Env Vars
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!rawPrivateKey) {
    logger.error('FIREBASE_PRIVATE_KEY is missing from environment variables');
  } else {
    logger.log(`Raw Private Key Length: ${rawPrivateKey.length}`);
  }

  // Handle all common env encodings:
  // - actual multiline key
  // - single escaped \n
  // - double escaped \\n (common in deployment UIs)
  const finalizedKey = rawPrivateKey
    ? rawPrivateKey
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\\\\n/g, '\n')
      .replace(/\\n/g, '\n')
    : undefined

  if (finalizedKey) {
    logger.log(`Finalized Private Key Length: ${finalizedKey.length}`)

    if (!finalizedKey.includes('-----BEGIN PRIVATE KEY-----')) {
      logger.error('Finalized key is missing BEGIN PRIVATE KEY header')
    }
    if (!finalizedKey.includes('-----END PRIVATE KEY-----')) {
      logger.error('Finalized key is missing END PRIVATE KEY footer')
    }
  }

  const firebaseConfig = {
    type: 'service_account',
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
    privateKey: finalizedKey,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    clientId: process.env.FIREBASE_CLIENT_ID,
    authUri: 'https://accounts.google.com/o/oauth2/auth',
    tokenUri: 'https://oauth2.googleapis.com/token',
    authProviderX509CertUrl: 'https://www.googleapis.com/oauth2/v1/certs',
    clientX509CertUrl: process.env.FIREBASE_CLIENT_C509_CERT_URL
      ? process.env.FIREBASE_CLIENT_C509_CERT_URL.replace(/["',]+$/g, '').replace(
        /^["']+/g,
        '',
      )
      : undefined,
  }

  firebase.initializeApp({
    credential: firebase.credential.cert(firebaseConfig),
  })

  app.use(
    '/api/v1/billing/webhook/polar',
    express.raw({ type: 'application/json' }),
  )
  app.useBodyParser('json', { limit: '2mb' })

  // Middleware to log all incoming requests, including OPTIONS
  app.use((req, res, next) => {
    logger.log(`Incoming Request: ${req.method} ${req.url} | Origin: ${req.headers.origin}`);
    next();
  });

  app.enableCors({
    origin: (origin, callback) => {
      // Allow non-browser clients
      if (!origin) {
        return callback(null, true);
      }

      // Check against allowed origins
      if (allowedOrigins.includes(origin)) {
        logger.log(`CORS ALLOWED for origin: ${origin}`); // Log success to verify it hits
        return callback(null, true);
      }

      logger.warn(`CORS BLOCKED for origin: ${origin}. Allowed: ${JSON.stringify(allowedOrigins)}`);
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-api-key',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
  })

  logger.log(`Server starting on port ${PORT}`);
  await app.listen(PORT)
}
bootstrap()
