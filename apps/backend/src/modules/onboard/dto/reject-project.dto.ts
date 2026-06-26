import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  comment!: string;
}
