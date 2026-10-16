import type { Service } from '../domain/service.js';
import { findAll } from '../repositories/service-repository.js';

export const listServices = async (): Promise<Service[]> => {
  const services = await findAll();
  return services;
};
