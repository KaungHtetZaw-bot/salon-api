import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApp } from '../src/app';

const app = createApp();

function handler(req: VercelRequest, res: VercelResponse): void {
  app(req, res);
}

export = handler;
