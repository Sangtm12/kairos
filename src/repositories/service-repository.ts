import type { Service } from '../domain/service.js';

const MOCK_SERVICES: Service[] = [
  {
    id: '01a145e1-362d-7275-9a32-be07724a7a3b',
    providerId: '01a145e1-362e-7792-9cfe-fc6dafe460c0',
    title: 'Mock service 1',
    durationMinutes: 45,
    priceMinor: 200_000,
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 0,
  },
];

export const findAll = async (): Promise<Service[]> => {
  await new Promise((res) => setTimeout(res, 100));
  return MOCK_SERVICES;
};
