import type { Request, Response } from 'express';
import express from 'express';
import { validateRequest } from '../middlewares/validateRequest.js';
import { findById } from '../repositories/service-repository.js';
import {
  createService,
  deleteService,
  listServices,
  updateService,
} from '../services/service-service.js';
import {
  CreateServiceSchema,
  DeleteServiceSchema,
  GetAllServicesSchema,
  GetServiceByIdSchema,
  UpdateServiceSchema,
  type CreateServiceBody,
  type DeleteServiceParams,
  type GetServiceByIdQueryParams,
  type UpdateServiceBody,
} from '../validators/service-validator.js';

export const serviceRouter = express.Router();

serviceRouter.get(
  '/',
  validateRequest(GetAllServicesSchema),
  async (_req: Request, res: Response) => {
    const services = await listServices();
    res.status(200).json({
      data: services,
    });
  },
);

serviceRouter.get(
  '/:serviceId',
  validateRequest(GetServiceByIdSchema, 'params'),
  async (_req: Request, res: Response<unknown, { validated: GetServiceByIdQueryParams }>) => {
    const { serviceId } = res.locals.validated;
    const service = await findById(serviceId);
    res.status(200).json({
      data: service,
    });
  },
);

serviceRouter.post(
  '/',
  validateRequest(CreateServiceSchema),
  async (_req, res: Response<unknown, { validated: CreateServiceBody }>) => {
    const service = await createService(res.locals.validated);
    res.status(201).json({
      data: service,
    });
  },
);

serviceRouter.patch(
  '/:serviceId',
  validateRequest(GetServiceByIdSchema, 'params', 'validatedParams'),
  validateRequest(UpdateServiceSchema),
  async (
    _req: Request,
    res: Response<
      unknown,
      { validatedParams: GetServiceByIdQueryParams; validated: UpdateServiceBody }
    >,
  ) => {
    const service = await updateService(res.locals.validatedParams.serviceId, res.locals.validated);
    res.status(200).json({
      data: service,
    });
  },
);

serviceRouter.delete(
  '/:serviceId',
  validateRequest(DeleteServiceSchema, 'params'),
  async (req: Request, res: Response<unknown, { validated: DeleteServiceParams }>) => {
    const service = await deleteService(res.locals.validated.serviceId);
    res.status(200).json({
      data: service,
    });
  },
);
