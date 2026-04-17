// Seed script for AI SaaS Business Platform
// Creates demo agency, tenants, users, and initial data

import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';

const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';

// Use Supabase admin client for auth operations
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Use Prisma for database operations (app tables)
const prisma = new PrismaClient();

// Demo credentials - users will need to use these to log in
const DEMO_USERS = {
  agencyAdmin: {
    email: 'agency-admin@demo.aisbp.com',
    password: 'Demo123!',
    fullName: 'Agency Admin',
  },
  agencyOperator: {
    email: 'agency-operator@demo.aisbp.com',
    password: 'Demo123!',
    fullName: 'Agency Operator',
  },
  tenantAAdmin: {
    email: 'tenant-a-admin@demo.aisbp.com',
    password: 'Demo123!',
    fullName: 'Tenant A Admin',
  },
  tenantBUser: {
    email: 'tenant-b-user@demo.aisbp.com',
    password: 'Demo123!',
    fullName: 'Tenant B User',
  },
};

async function createAuthUser(email: string, password: string, fullName: string): Promise<string> {
  // Check if user exists
  const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
  const found = existingUser?.users.find(u => u.email === email);

  if (found) {
    console.log(`  Auth user exists: ${email}`);
    return found.id;
  }

  // Create auth user
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) {
    throw new Error(`Failed to create auth user ${email}: ${error.message}`);
  }

  console.log(`  Created auth user: ${email}`);
  return data.user.id;
}

async function seed() {
  console.log('\n🚀 Starting seed process...\n');

  try {
    // 1. Create auth users
    console.log('📝 Creating auth users...');
    const agencyAdminId = await createAuthUser(
      DEMO_USERS.agencyAdmin.email,
      DEMO_USERS.agencyAdmin.password,
      DEMO_USERS.agencyAdmin.fullName
    );
    const agencyOperatorId = await createAuthUser(
      DEMO_USERS.agencyOperator.email,
      DEMO_USERS.agencyOperator.password,
      DEMO_USERS.agencyOperator.fullName
    );
    const tenantAAdminId = await createAuthUser(
      DEMO_USERS.tenantAAdmin.email,
      DEMO_USERS.tenantAAdmin.password,
      DEMO_USERS.tenantAAdmin.fullName
    );
    const tenantBUserId = await createAuthUser(
      DEMO_USERS.tenantBUser.email,
      DEMO_USERS.tenantBUser.password,
      DEMO_USERS.tenantBUser.fullName
    );

    // 2. Create profiles (via Prisma since auth.users is managed by Supabase)
    console.log('\n👤 Creating profiles...');

    // For Supabase Auth, profiles.id should match auth.users.id
    // We need to insert profiles with the same IDs as auth users
    const profiles = await Promise.all([
      prisma.profile.upsert({
        where: { id: agencyAdminId },
        update: { email: DEMO_USERS.agencyAdmin.email, fullName: DEMO_USERS.agencyAdmin.fullName },
        create: { id: agencyAdminId, email: DEMO_USERS.agencyAdmin.email, fullName: DEMO_USERS.agencyAdmin.fullName },
      }),
      prisma.profile.upsert({
        where: { id: agencyOperatorId },
        update: { email: DEMO_USERS.agencyOperator.email, fullName: DEMO_USERS.agencyOperator.fullName },
        create: { id: agencyOperatorId, email: DEMO_USERS.agencyOperator.email, fullName: DEMO_USERS.agencyOperator.fullName },
      }),
      prisma.profile.upsert({
        where: { id: tenantAAdminId },
        update: { email: DEMO_USERS.tenantAAdmin.email, fullName: DEMO_USERS.tenantAAdmin.fullName },
        create: { id: tenantAAdminId, email: DEMO_USERS.tenantAAdmin.email, fullName: DEMO_USERS.tenantAAdmin.fullName },
      }),
      prisma.profile.upsert({
        where: { id: tenantBUserId },
        update: { email: DEMO_USERS.tenantBUser.email, fullName: DEMO_USERS.tenantBUser.fullName },
        create: { id: tenantBUserId, email: DEMO_USERS.tenantBUser.email, fullName: DEMO_USERS.tenantBUser.fullName },
      }),
    ]);
    console.log(`  Created ${profiles.length} profiles`);

    // 3. Create agency
    console.log('\n🏢 Creating agency...');
    const agency = await prisma.agency.upsert({
      where: { id: 'demo-agency-001' },
      update: { name: 'Demo Agency' },
      create: {
        id: 'demo-agency-001',
        name: 'Demo Agency',
        settings: {
          defaultOutputFormat: 'bubble',
          allowTenantModelOverride: true,
          quotaWarningThreshold: 80,
        },
      },
    });
    console.log(`  Created agency: ${agency.id}`);

    // 4. Create agency memberships
    console.log('\n👥 Creating agency memberships...');
    await prisma.agencyUser.upsert({
      where: { agencyId_profileId: { agencyId: agency.id, profileId: agencyAdminId } },
      update: { role: 'OWNER' },
      create: { agencyId: agency.id, profileId: agencyAdminId, role: 'OWNER' },
    });
    await prisma.agencyUser.upsert({
      where: { agencyId_profileId: { agencyId: agency.id, profileId: agencyOperatorId } },
      update: { role: 'OPERATOR' },
      create: { agencyId: agency.id, profileId: agencyOperatorId, role: 'OPERATOR' },
    });
    console.log('  Created agency memberships');

    // 5. Create tenants
    console.log('\n🏠 Creating tenants...');
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const tenantA = await prisma.tenant.upsert({
      where: { id: 'demo-tenant-a' },
      update: { name: 'Tenant A - Acme Corp' },
      create: {
        id: 'demo-tenant-a',
        agencyId: agency.id,
        name: 'Tenant A - Acme Corp',
        ghlLocationId: 'demo-ghl-location-a',
        status: 'active',
        settings: {
          timezone: 'America/New_York',
          language: 'en',
          autoTransferOnHandover: false,
        },
      },
    });

    const tenantB = await prisma.tenant.upsert({
      where: { id: 'demo-tenant-b' },
      update: { name: 'Tenant B - Beta Inc' },
      create: {
        id: 'demo-tenant-b',
        agencyId: agency.id,
        name: 'Tenant B - Beta Inc',
        ghlLocationId: 'demo-ghl-location-b',
        status: 'active',
        settings: {
          timezone: 'America/Los_Angeles',
          language: 'en',
          autoTransferOnHandover: true,
        },
      },
    });
    console.log(`  Created tenants: ${tenantA.name}, ${tenantB.name}`);

    // 6. Create tenant memberships
    console.log('\n👥 Creating tenant memberships...');
    await prisma.tenantUser.upsert({
      where: { tenantId_profileId: { tenantId: tenantA.id, profileId: tenantAAdminId } },
      update: { role: 'ADMIN' },
      create: { tenantId: tenantA.id, profileId: tenantAAdminId, role: 'ADMIN' },
    });
    await prisma.tenantUser.upsert({
      where: { tenantId_profileId: { tenantId: tenantB.id, profileId: tenantBUserId } },
      update: { role: 'AGENT' },
      create: { tenantId: tenantB.id, profileId: tenantBUserId, role: 'AGENT' },
    });
    console.log('  Created tenant memberships');

    // 7. Create agency model provider
    console.log('\n🤖 Creating agency model provider...');
    await prisma.agencyModelProvider.upsert({
      where: { agencyId_provider: { agencyId: agency.id, provider: 'OPENAI' } },
      update: { settings: { defaultModel: 'gpt-4o', maxTokens: 4000, temperature: 0.7 } },
      create: {
        agencyId: agency.id,
        provider: 'OPENAI',
        apiKey: 'demo-key-placeholder',
        endpoint: null,
        settings: {
          defaultModel: 'gpt-4o',
          maxTokens: 4000,
          temperature: 0.7,
        },
      },
    });
    console.log('  Created model provider placeholder');

    // 8. Create agency system policy
    console.log('\n📋 Creating agency system policy...');
    await prisma.agencySystemPolicy.upsert({
      where: { id: 'demo-policy-001' },
      update: { content: 'You are a helpful AI assistant. Be concise and friendly.' },
      create: {
        id: 'demo-policy-001',
        agencyId: agency.id,
        name: 'Default System Policy',
        content: 'You are a helpful AI assistant for a business chatbot. Keep responses concise, friendly, and professional. Do not make up information. If you do not know something, say so.',
        priority: 0,
        isDefault: true,
      },
    });
    console.log('  Created system policy');

    // 9. Create tenant prompt configs
    console.log('\n⚙️ Creating tenant prompt configs...');

    const promptConfigA = await prisma.tenantPromptConfig.upsert({
      where: { id: 'demo-prompt-a' },
      update: {
        name: 'Tenant A Assistant',
        systemPrompt: 'You are a helpful assistant for Acme Corp customers. Be friendly and professional.',
        temperature: 0.7,
        modelOverride: 'gpt-4o-mini',
      },
      create: {
        id: 'demo-prompt-a',
        tenantId: tenantA.id,
        name: 'Tenant A Assistant',
        systemPrompt: 'You are a helpful assistant for Acme Corp customers. Be friendly, professional, and knowledgeable about Acme products and services.',
        temperature: 0.7,
        modelOverride: 'gpt-4o-mini',
        maxTokens: 1000,
        promptVariables: {
          companyName: 'Acme Corp',
          supportEmail: 'support@acme.com',
          website: 'https://acme.com',
        },
        isActive: true,
      },
    });

    await prisma.tenantPromptConfig.upsert({
      where: { id: 'demo-prompt-b' },
      update: {
        name: 'Tenant B Assistant',
        systemPrompt: 'You are a helpful assistant for Beta Inc customers.',
        temperature: 0.8,
      },
      create: {
        id: 'demo-prompt-b',
        tenantId: tenantB.id,
        name: 'Tenant B Assistant',
        systemPrompt: 'You are a helpful assistant for Beta Inc customers. Be friendly, helpful, and efficient.',
        temperature: 0.8,
        modelOverride: null,
        maxTokens: 800,
        promptVariables: {
          companyName: 'Beta Inc',
        },
        isActive: true,
      },
    });
    console.log('  Created tenant prompt configs');

    // 10. Create quota wallets
    console.log('\n💰 Creating quota wallets...');

    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    await prisma.quotaWallet.upsert({
      where: { tenantId: tenantA.id },
      update: {
        totalQuota: 10000,
        usedQuota: 1250,
        periodStart,
        periodEnd: periodEndDate,
      },
      create: {
        tenantId: tenantA.id,
        totalQuota: 10000,
        usedQuota: 1250,
        periodStart,
        periodEnd: periodEndDate,
      },
    });

    await prisma.quotaWallet.upsert({
      where: { tenantId: tenantB.id },
      update: {
        totalQuota: 5000,
        usedQuota: 450,
        periodStart,
        periodEnd: periodEndDate,
      },
      create: {
        tenantId: tenantB.id,
        totalQuota: 5000,
        usedQuota: 450,
        periodStart,
        periodEnd: periodEndDate,
      },
    });
    console.log('  Created quota wallets');

    // 11. Create quota ledger entries
    console.log('\n📊 Creating quota ledger entries...');

    // Get wallet IDs
    const walletA = await prisma.quotaWallet.findUnique({ where: { tenantId: tenantA.id } });
    const walletB = await prisma.quotaWallet.findUnique({ where: { tenantId: tenantB.id } });

    if (walletA) {
      await prisma.quotaLedger.createMany({
        data: [
          { walletId: walletA.id, amount: 10000, type: 'CREDIT', description: 'Monthly quota allocation' },
          { walletId: walletA.id, amount: -150, type: 'DEBIT', description: 'AI response' },
          { walletId: walletA.id, amount: -200, type: 'DEBIT', description: 'AI response' },
          { walletId: walletA.id, amount: -100, type: 'DEBIT', description: 'AI response' },
          { walletId: walletA.id, amount: -300, type: 'DEBIT', description: 'AI response' },
          { walletId: walletA.id, amount: -500, type: 'DEBIT', description: 'AI response' },
        ],
        skipDuplicates: true,
      });
    }

    if (walletB) {
      await prisma.quotaLedger.createMany({
        data: [
          { walletId: walletB.id, amount: 5000, type: 'CREDIT', description: 'Monthly quota allocation' },
          { walletId: walletB.id, amount: -150, type: 'DEBIT', description: 'AI response' },
          { walletId: walletB.id, amount: -300, type: 'DEBIT', description: 'AI response' },
        ],
        skipDuplicates: true,
      });
    }
    console.log('  Created quota ledger entries');

    console.log('\n✅ Seed completed successfully!\n');
    console.log('='.repeat(60));
    console.log('\n📋 Demo Login Credentials:\n');
    console.log('Agency Admin (can see all tenants):');
    console.log(`  Email: ${DEMO_USERS.agencyAdmin.email}`);
    console.log(`  Password: ${DEMO_USERS.agencyAdmin.password}`);
    console.log('\nAgency Operator (can see all tenants):');
    console.log(`  Email: ${DEMO_USERS.agencyOperator.email}`);
    console.log(`  Password: ${DEMO_USERS.agencyOperator.password}`);
    console.log('\nTenant A Admin (can see only Tenant A):');
    console.log(`  Email: ${DEMO_USERS.tenantAAdmin.email}`);
    console.log(`  Password: ${DEMO_USERS.tenantAAdmin.password}`);
    console.log('\nTenant B Agent (can see only Tenant B):');
    console.log(`  Email: ${DEMO_USERS.tenantBUser.email}`);
    console.log(`  Password: ${DEMO_USERS.tenantBUser.password}`);
    console.log('\n' + '='.repeat(60));
    console.log('\n📁 Demo Data Created:\n');
    console.log(`  Agency: ${agency.name} (${agency.id})`);
    console.log(`  Tenant A: ${tenantA.name} (${tenantA.id})`);
    console.log(`  Tenant B: ${tenantB.name} (${tenantB.id})`);
    console.log(`  Prompt Configs: ${promptConfigA.name} and others`);
    console.log(`  Quota Wallets: Tenant A (${walletA?.totalQuota}), Tenant B (${walletB?.totalQuota})`);
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seed();