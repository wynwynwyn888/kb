// Contacts controller

import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const STUB_DESC = 'Not implemented: handler throws. JWT required.';

@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post('tags')
  @ApiOperation({
    summary: '[Stub] Add contact tags',
    deprecated: true,
    description: STUB_DESC,
  })
  async addTags(@Body() dto: {
    tenantId: string;
    ghlContactId: string;
    tags: string[];
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('tags/remove')
  @ApiOperation({
    summary: '[Stub] Remove contact tags',
    deprecated: true,
    description: STUB_DESC,
  })
  async removeTags(@Body() dto: {
    tenantId: string;
    ghlContactId: string;
    tags: string[];
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get(':ghlContactId')
  @ApiOperation({
    summary: '[Stub] Get contact',
    deprecated: true,
    description: STUB_DESC,
  })
  async getContact(
    @Param('ghlContactId') ghlContactId: string,
    @Query('tenantId') tenantId: string,
  ) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Post('update')
  @ApiOperation({
    summary: '[Stub] Update contact',
    deprecated: true,
    description: STUB_DESC,
  })
  async updateContact(@Body() dto: {
    tenantId: string;
    ghlContactId: string;
    data: Record<string, unknown>;
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}
