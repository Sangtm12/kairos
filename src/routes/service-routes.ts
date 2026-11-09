import type { Request, Response } from 'express';
import express from 'express';
import { validateRequest } from '../middlewares/validate-request.js';
import {
  createService,
  deleteService,
  getServiceById,
  listServices,
  updateService,
} from '../services/service-service.js';
import {
  CreateServiceSchema,
  GetAllServicesSchema,
  ServiceIdParamsSchema,
  UpdateServiceSchema,
  type CreateServiceBody,
  type GetAllServicesQuery,
  type ServiceIdParams,
  type UpdateServiceBody,
} from '../validators/service-validator.js';

export const serviceRouter = express.Router();

serviceRouter.get(
  '/',
  validateRequest(GetAllServicesSchema, 'query'),
  async (_req: Request, res: Response<unknown, { validated: GetAllServicesQuery }>) => {
    const { page, perPage } = res.locals.validated;
    const services = await listServices(page, perPage);
    res.status(200).json({
      data: services,
    });
  },
);

serviceRouter.get(
  '/:serviceId',
  validateRequest(ServiceIdParamsSchema, 'params'),
  async (_req: Request, res: Response<unknown, { validated: ServiceIdParams }>) => {
    const service = await getServiceById(res.locals.validated.serviceId);
    res.status(200).json({
      data: service,
    });
  },
);

serviceRouter.post(
  '/',
  validateRequest(CreateServiceSchema),
  async (_req: Request, res: Response<unknown, { validated: CreateServiceBody }>) => {
    const service = await createService(res.locals.validated);
    res.status(201).json({
      data: service,
    });
  },
);

serviceRouter.patch(
  '/:serviceId',
  validateRequest(ServiceIdParamsSchema, 'params', 'validatedParams'),
  validateRequest(UpdateServiceSchema),
  async (
    _req: Request,
    res: Response<unknown, { validatedParams: ServiceIdParams; validated: UpdateServiceBody }>,
  ) => {
    const service = await updateService(res.locals.validatedParams.serviceId, res.locals.validated);
    res.status(200).json({
      data: service,
    });
  },
);

serviceRouter.delete(
  '/:serviceId',
  validateRequest(ServiceIdParamsSchema, 'params'),
  async (_req: Request, res: Response<unknown, { validated: ServiceIdParams }>) => {
    const service = await deleteService(res.locals.validated.serviceId);
    res.status(200).json({
      data: service,
    });
  },
);
