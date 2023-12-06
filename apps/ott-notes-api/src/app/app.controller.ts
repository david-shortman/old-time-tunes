import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Express } from 'express';
// This is a hack to make Multer available in the Express namespace
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Multer } from 'multer';
import { OTTAudio2Notes } from '@ot-tunes/audio2notes-node';

@Controller()
export class AppController {
  @Post('notes')
  @UseInterceptors(FileInterceptor('file'))
  getNotes(@UploadedFile() file: Express.Multer.File) {
    return OTTAudio2Notes.convert(file.buffer);
  }
}
