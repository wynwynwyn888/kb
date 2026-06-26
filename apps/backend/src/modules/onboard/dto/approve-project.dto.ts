import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
