import { Provider } from '@nestjs/common';
import { loadEnv, type Env } from '@ventureos/config';

export const ENV_TOKEN = 'VENTUREOS_ENV';

export const envProvider: Provider = {
  provide: ENV_TOKEN,
  useFactory: (): Env => loadEnv(),
};
