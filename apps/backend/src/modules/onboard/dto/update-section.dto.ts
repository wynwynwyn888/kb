import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sectionStatus?: string;
}
