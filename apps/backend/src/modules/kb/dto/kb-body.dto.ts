import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateKbFaqBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  question!: string;

  @IsString()
  @IsNotEmpty()
  answer!: string;

  @IsOptional()
  @IsUUID()
  vaultId?: string;
}

export class UpdateKbFaqBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  question!: string;

  @IsString()
  @IsNotEmpty()
  answer!: string;
}

export class CreateKbRichTextBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsUUID()
  vaultId?: string;
}

export class UpdateKbRichTextBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class KbFileUploadBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsOptional()
  @IsUUID()
  vaultId?: string;
}

export class ImportWebsiteBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  url!: string;

  @IsOptional()
  @IsUUID()
  vaultId?: string;

  @IsOptional()
  @IsString()
  crawlMode?: 'single' | 'sitemap' | 'crawl';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxPages?: number;
}

export class KbSearchBodyDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;

  @IsOptional()
  @IsString()
  conversationId?: string;

  /** Optional intent label for generic retrieval scoring (e.g. BUSINESS_HOURS, MENU). */
  @IsOptional()
  @IsString()
  intentHint?: string;

  /** When set, search only chunks for documents in this vault (Knowledge page scope). */
  @IsOptional()
  @IsUUID()
  vaultId?: string;
}
