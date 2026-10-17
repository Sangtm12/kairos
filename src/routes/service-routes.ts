import express from 'express';
import type { Request, Response } from 'express';
import { listServices } from '../services/catalog-service.js';

export const serviceRouter = express.Router();

serviceRouter.get('/', async (_req: Request, res: Response) => {
  const services = await listServices();
  res.status(200).json({
    data: services,
  });
});
