import * as z from 'zod';

export const GetAllServicesSchema = z
  .strictObject({
    perPage: z.number().min(1).optional(),
    page: z.number().min(1).optional(),
  })
  .optional();

export const GetServiceByIdSchema = z.strictObject({
  serviceId: z.uuid(),
});

export const CreateServiceSchema = z.strictObject({
  providerId: z.uuid(),
  title: z.string().min(1).max(255),
  durationMinutes: z.number().min(1),
  priceMinor: z.number().min(0),
  bufferBeforeMinutes: z.number().min(0).optional(),
  bufferAfterMinutes: z.number().min(0).optional(),
});

export const UpdateServiceSchema = z
  .strictObject({
    title: z.string().min(1).max(255).optional(),
    durationMinutes: z.number().min(1).optional(),
    priceMinor: z.number().min(0).optional(),
    bufferBeforeMinutes: z.number().min(0).optional(),
    bufferAfterMinutes: z.number().min(0).optional(),
  })
  .refine((service) => Object.keys(service).length > 0, {
    message: 'At least one service field must be provided',
  });

export const DeleteServiceSchema = z.strictObject({
  serviceId: z.uuid(),
});

export type GetAllServicesQueryParams = z.infer<typeof GetAllServicesSchema>;
export type GetServiceByIdQueryParams = z.infer<typeof GetServiceByIdSchema>;
export type CreateServiceBody = z.infer<typeof CreateServiceSchema>;
export type UpdateServiceBody = z.infer<typeof UpdateServiceSchema>;
export type DeleteServiceParams = z.infer<typeof DeleteServiceSchema>;
