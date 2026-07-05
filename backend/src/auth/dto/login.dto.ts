import { IsOptional, IsString } from 'class-validator'

export class LoginDto {
  @IsString()
  initData!: string

  @IsOptional()
  @IsString()
  instagramUsername?: string
}
