import express from 'express';
import cors from 'cors';
import defaultConfig from './config.js';
import { getDatasets } from './data/datasets.js';
import { createStorage } from './services/storage.js';
import { createTokenService } from './services/tokenService.js';
import { createGeminiService } from './services/geminiService.js';
import { createAssessmentService } from './services/assessmentService.js';
import { createWordService } from './services/wordService.js';
import { createExtensionService } from './services/extensionService.js';
import { createAuth } from './middleware/auth.js';
import { createAuthController } from './controllers/authController.js';
import { createProfileController } from './controllers/profileController.js';
import { createDashboardController } from './controllers/dashboardController.js';
import { createAssessmentController } from './controllers/assessmentController.js';
import { createAccessibilityController } from './controllers/accessibilityController.js';
import { createAiController } from './controllers/aiController.js';
import { createEvaluationController } from './controllers/evaluationController.js';
import { createExtensionController } from './controllers/extensionController.js';
import { createRoutes } from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

/** Builds the Express app. Every dependency can be injected (used by the tests). */
export function createApp({ config = defaultConfig, ai, storage, datasets, rng } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const data = datasets || getDatasets(config.datasetsDir);
  const store = storage || createStorage(config.storageDir);
  const tokens = createTokenService(config.jwtSecret);
  const aiService = ai || createGeminiService(config.gemini);
  const assessment = createAssessmentService({ datasets: data, ...(rng ? { rng } : {}) });
  const words = createWordService({ vocabulary: data.vocabulary, ai: aiService });
  const extension = createExtensionService({ storage: store, tokens });

  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || config.corsOrigins.includes(origin) || origin.startsWith('chrome-extension://')) return cb(null, true);
        cb(null, false);
      },
    })
  );
  app.use(express.json({ limit: '64kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(
    '/api',
    createRoutes({
      config,
      ai: aiService,
      auth: createAuth({ tokens, storage: store }),
      c: {
        auth: createAuthController({ storage: store, tokens }),
        profile: createProfileController({ storage: store, config }),
        dashboard: createDashboardController({ assessment, datasets: data }),
        assessment: createAssessmentController({ storage: store, assessment }),
        accessibility: createAccessibilityController({ storage: store }),
        ai: createAiController({ ai: aiService, words }),
        evaluation: createEvaluationController({ storage: store, config }),
        extension: createExtensionController({ extension }),
      },
    })
  );
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
