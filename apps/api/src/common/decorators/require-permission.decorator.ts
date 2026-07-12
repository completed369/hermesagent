import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'ventureos:permission';
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);
