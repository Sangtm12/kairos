import { NotFoundError, ValidationError } from '../domain/errors.js';
import type { NewService, Service, ServiceChanges } from '../domain/service.js';
import { findAll, findById, insert, remove, update } from '../repositories/service-repository.js';

export const listServices = async (page: number, perPage: number): Promise<Service[]> => {
  const services = await findAll(page, perPage);
  return services;
};

export const getServiceById = async (serviceId: string): Promise<Service> => {
  const service = await findById(serviceId);
  if (!service) throw new NotFoundError(`Service with ID ${serviceId} not found`);
  return service;
};

export const createService = async (newService: NewService): Promise<Service> => {
  const service = await insert(newService);
  // insert() only writes when the provider exists and is not soft-deleted
  if (!service) {
    throw new ValidationError('Input validation failed', { providerId: 'Provider not found' });
  }
  return service;
};

export const updateService = async (
  serviceId: string,
  changes: ServiceChanges,
): Promise<Service> => {
  const service = await update(serviceId, changes);
  if (!service) throw new NotFoundError(`Service with ID ${serviceId} not found`);
  return service;
};

export const deleteService = async (serviceId: string): Promise<Service> => {
  const service = await remove(serviceId);
  if (!service) throw new NotFoundError(`Service with ID ${serviceId} not found`);
  return service;
};
