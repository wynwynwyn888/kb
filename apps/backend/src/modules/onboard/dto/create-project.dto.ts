import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  onboardClientId!: string;
}
