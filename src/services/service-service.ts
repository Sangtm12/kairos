import { NotFoundError } from '../domain/errors.js';
import type { Service } from '../domain/service.js';
import { findAll, findById, insert, remove, update } from '../repositories/service-repository.js';
import type { CreateServiceBody, UpdateServiceBody } from '../validators/service-validator.js';

export const listServices = async (): Promise<Service[]> => {
  const services = await findAll();
  return services;
};

export const getServiceById = async (serviceId: string): Promise<Service | null> => {
  const service = await findById(serviceId);
  if (!service) throw new NotFoundError(`Service with ID ${serviceId} not found`);
  return service;
};

export const createService = async (createServiceBody: CreateServiceBody) => {
  const service = await insert(createServiceBody);
  return service;
};

export const updateService = async (serviceId: string, updateServiceBody: UpdateServiceBody) => {
  const service = await update(serviceId, updateServiceBody);
  if (!service) throw new NotFoundError(`Service with ID ${serviceId} not found`);
  return service;
};

export const deleteService = async (serviceId: string) => {
  const service = await remove(serviceId);
  return service;
};
