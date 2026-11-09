import * as z from 'zod';

export const GetAllServicesSchema = z.strictObject({
  perPage: z.coerce.number().int().min(1).max(100).default(10),
  page: z.coerce.number().int().min(1).default(1),
});

export const ServiceIdParamsSchema = z.strictObject({
  serviceId: z.uuid(),
});

export const CreateServiceSchema = z.strictObject({
  providerId: z.uuid(),
  title: z.string().trim().min(1).max(255),
  durationMinutes: z.int().min(1).max(1440),
  priceMinor: z.int().nonnegative(),
  bufferBeforeMinutes: z.int().min(0).max(1440).optional(),
  bufferAfterMinutes: z.int().min(0).max(1440).optional(),
});

export const UpdateServiceSchema = CreateServiceSchema.omit({ providerId: true })
  .partial()
  .refine((service) => Object.keys(service).length > 0, {
    message: 'At least one service field must be provided',
  });

export type GetAllServicesQuery = z.infer<typeof GetAllServicesSchema>;
export type ServiceIdParams = z.infer<typeof ServiceIdParamsSchema>;
export type CreateServiceBody = z.infer<typeof CreateServiceSchema>;
export type UpdateServiceBody = z.infer<typeof UpdateServiceSchema>;
