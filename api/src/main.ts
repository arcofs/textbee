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
  const PORT = process.env.API_PORT || process.env.PORT || 3001

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
    logger.log(`Raw Private Key Start: ${rawPrivateKey.substring(0, 40)}...`);
    logger.log(`Raw Private Key End: ...${rawPrivateKey.substring(rawPrivateKey.length - 40)}`);
    logger.log(`Raw Private Key Includes \\n literal: ${rawPrivateKey.includes('\\n')}`);
    logger.log(`Raw Private Key Includes actual newline: ${rawPrivateKey.includes('\n')}`);
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
    logger.log(`Finalized Private Key Start: ${finalizedKey.substring(0, 40)}...`)
    logger.log(
      `Finalized Private Key End: ...${finalizedKey.substring(finalizedKey.length - 40)}`,
    )

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
  app.useBodyParser('json', { limit: '2mb' });
  app.enableCors()
  await app.listen(PORT)
}
bootstrap()
