import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'hr@med-tech.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Use the password issued by the system administrator' })
  @IsString()
  @MinLength(8)
  password: string;
}
