import { IsOptional, IsString } from 'class-validator';

export class KbDryRunDto {
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
