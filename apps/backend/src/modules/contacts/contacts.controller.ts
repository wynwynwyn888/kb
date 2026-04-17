// Contacts controller

import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';

@ApiTags('contacts')
@ApiBearerAuth()
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post('tags')
  async addTags(@Body() dto: {
    tenantId: string;
    ghlContactId: string;
    tags: string[];
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('tags/remove')
  async removeTags(@Body() dto: {
    tenantId: string;
    ghlContactId: string;
    tags: string[];
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get(':ghlContactId')
  async getContact(
    @Param('ghlContactId') ghlContactId: string,
    @Query('tenantId') tenantId: string,
  ) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('update')
  async updateContact(@Body() dto: {
    tenantId: string;
    ghlContactId: string;
    data: Record<string, unknown>;
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}