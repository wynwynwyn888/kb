import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  clientKey!: string;

  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s\-()]+$/, { message: 'contactPhone must be a valid phone number format' })
  contactPhone?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  whatsappPhone?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
