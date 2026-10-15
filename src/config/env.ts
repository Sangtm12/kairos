import z from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const configEnv = () => {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    console.error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }

  const env = result.data;

  return Object.freeze({
    port: env.PORT,
    dbHost: env.DB_HOST,
    dbPort: env.DB_PORT,
    dbUser: env.DB_USER,
    dbPassword: env.DB_PASSWORD,
    dbName: env.DB_NAME,
    nodeEnv: env.NODE_ENV,
  });
};

export const config = configEnv();
