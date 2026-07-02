/**
 * Seed the AISBP Agency Knowledge Vault with FAQs and Rich Text Notes.
 *
 * Uses Supabase service-role key (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * Idempotent — updates existing docs by matching title/question instead of creating duplicates.
 *
 * Usage:
 *   cd apps/backend
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-aisbp-vault.ts
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// --------------- config ---------------

const TENANT_ID = '34c62859-95b1-49a8-911c-cc44ced05452';
const VAULT_NAME = 'AISBP Agency';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --------------- helpers ---------------

function faqTitle(question: string) {
  return question.slice(0, 200);
}

function faqOldTitle(question: string) {
  return `FAQ: ${question.slice(0, 200)}`;
}

function noteOldTitle(title: string) {
  return `AISBP ${title}`;
}

interface FaqEntry {
  question: string;
  answer: string;
}

interface NoteEntry {
  title: string;
  content: string;
}

// --------------- data ---------------

const FAQS: FaqEntry[] = [
  {
    question:
      'How much does AI Sales Bot Pro cost? Price, pricing, fee, package, rate',
    answer: [
      'Pricing is only discussed during the 45-minute AI Automation Session because the right setup depends on the business\'s lead flow, automation scope, sales process, and ROI potential.',
      '',
      'The useful way to look at pricing is not just software cost. It is whether AI Sales Bot Pro can recover missed revenue, save staff time, reduce manual chasing, improve response speed, and increase conversion.',
      '',
      'The next step is to review the business numbers first in the AI Automation Session.',
      '',
      'Booking link:',
      'https://aisalesbot.pro/booking',
    ].join('\n'),
  },
  {
    question:
      'What ROI can I expect? ROI, return, save cost, increase sales, 30%, $100k',
    answer: [
      'ROI depends on the business\'s lead volume, response time, booking or conversion rate, show-up rate where applicable, close rate, average deal value, staff time, missed follow-ups, and no-shows where applicable.',
      '',
      'AI Sales Bot Pro has an ROI calculator that helps estimate how much return the business may get back from the investment based on real numbers.',
      '',
      'The goal is not to make a blind guarantee. The goal is to identify where money is leaking and whether AI can help save cost, recover missed revenue, and potentially increase sales by 30% or more.',
      '',
      'If the numbers are not good, there is no obligation.',
    ].join('\n'),
  },
  {
    question:
      'How does setup work? Setup, onboarding, implementation, technical, install',
    answer: [
      'Setup is meant to be simple for the business owner.',
      '',
      'We review the business\'s enquiries, offers, FAQs, sales process, follow-up flow, common objections, reminders, reactivation needs, and human handover rules.',
      '',
      'The business owner does not need to be technical. The goal is to turn the current sales process into a more consistent AI-assisted flow.',
      '',
      'The best next step is the 45-minute AI Automation Session, where we first identify the sales leaks and automation opportunities.',
    ].join('\n'),
  },
  {
    question:
      'I already have staff replying to WhatsApp. Why do I need AI Sales Bot Pro? Staff, manpower, team, receptionist, sales person',
    answer: [
      'AI Sales Bot Pro does not replace good staff. It supports them.',
      '',
      'The AI Sales Agent handles repetitive replies, after-hours enquiries, missed follow-ups, manual chasing, and inconsistent first-layer lead handling.',
      '',
      'Your team can focus on serious conversations while the AI makes sure every enquiry is replied to, followed up, and guided toward the next step.',
      '',
      'The real issue is usually not whether leads get replied to once. It is whether every enquiry is handled fast, followed up consistently, and moved toward booking or sales.',
    ].join('\n'),
  },
  {
    question:
      'Can I just use ChatGPT? ChatGPT, free AI, AI tool, chatbot',
    answer: [
      'ChatGPT can help write replies or scripts, but AI Sales Bot Pro is built to support the sales follow-up process.',
      '',
      'It helps with instant replies, qualification, objection handling, follow-up, booking push, reminders, reactivation, and human handover rules.',
      '',
      'ChatGPT gives you text. AI Sales Bot Pro helps run the lead conversation and follow-up system more consistently.',
    ].join('\n'),
  },
  {
    question:
      'What if the AI says the wrong thing? Wrong answer, mistake, hallucination, guardrails, control',
    answer: [
      'That is why setup and guardrails matter.',
      '',
      'The AI should be given clear rules on what it can answer, what it should avoid, and when to hand over to a human.',
      '',
      'For sensitive questions, pricing exceptions, complaints, contract terms, payment terms, or unusual cases, it should escalate instead of guessing.',
      '',
      'AI Sales Bot Pro is meant to support the sales process, not blindly answer everything.',
    ].join('\n'),
  },
  {
    question:
      'Can AI really sell like a human? Human salesperson, sales closing, closer, AI selling',
    answer: [
      'AI should not replace a strong human closer for high-value conversations.',
      '',
      'The real value is earlier in the sales process: instant replies, qualification, follow-up, objection handling, reminders, and moving serious leads toward the next step.',
      '',
      'Most lost sales do not happen only at the final closing stage. They happen because leads are replied to slowly, forgotten, not followed up, not reminded, or not guided properly.',
      '',
      'AI Sales Bot Pro helps make sure every lead is handled properly before your human team steps in.',
    ].join('\n'),
  },
  {
    question:
      'Will this work for my industry? Industry, business type, clinic, salon, service business, B2B, ecommerce, retail',
    answer: [
      'AI Sales Bot Pro is industry-neutral because most businesses share the same sales leakage problem.',
      '',
      'Enquiries come in. Customers ask questions. Staff may reply slowly. Follow-up may be inconsistent. Leads may go cold. Money leaks from the sales process.',
      '',
      'For appointment-based businesses, we look at bookings, reminders, no-shows, and show-up rate.',
      '',
      'For quotation-based businesses, we look at enquiry handling, qualification, quote follow-up, and lead conversion.',
      '',
      'For ecommerce or retail, we look at product questions, abandoned enquiries, repeat purchase, reviews, and support automation.',
      '',
      'For B2B, we look at lead qualification, sales follow-up, appointment setting, pipeline speed, and manual chasing.',
    ].join('\n'),
  },
  {
    question:
      'What is the 45-minute AI Automation Session? Session, booking, call, consultation, appointment',
    answer: [
      'The 45-minute AI Automation Session is a practical business review.',
      '',
      'It is not a discovery call, mapping call, or generic sales pitch.',
      '',
      'In the session, we review the business\'s lead flow, response speed, follow-up process, booking or sales process, missed opportunities, manual workload, and automation potential.',
      '',
      'The goal is to uncover sales leaks and show using real figures where AI Sales Bot Pro can help save cost, recover revenue, and increase sales.',
      '',
      'Booking link:',
      'https://aisalesbot.pro/booking',
    ].join('\n'),
  },
  {
    question:
      'I do not want robotic replies. Robotic, natural, human, tone, chatbot',
    answer: [
      'That is exactly why setup matters.',
      '',
      'The AI should not sound robotic or generic. It should be trained around the business\'s offers, FAQs, tone, objections, sales process, and handover rules.',
      '',
      'The goal is to make it feel like a helpful AI Sales Agent, not a cold bot.',
      '',
      'A good AI Sales Agent should answer clearly, guide the customer naturally, and know when to hand over to the team.',
    ].join('\n'),
  },
];

const NOTES: NoteEntry[] = [
  {
    title: 'Objection Handling Playbook',
    content: [
      '## Objection: I already have staff replying to WhatsApp',
      '',
      'AI Sales Bot Pro does not replace good staff. It supports them.',
      '',
      'The issue is usually not whether someone replies once. The issue is whether every enquiry is handled fast, followed up consistently, and guided toward the next step.',
      '',
      'Staff can focus on serious conversations while the AI Sales Agent handles repetitive replies, after-hours enquiries, missed follow-ups, manual chasing, and first-layer lead handling.',
      '',
      '## Objection: It is too expensive',
      '',
      'Reframe price against missed revenue, lost opportunities, staff time, weak follow-up, and manual chasing.',
      '',
      'The real comparison is not AI versus no AI. It is AI versus missed leads, slow replies, forgotten follow-ups, no-shows where applicable, and prospects who never get properly chased.',
      '',
      'If the system helps recover even a few extra appointments, quotations, purchases, or sales, it becomes a revenue tool rather than a cost.',
      '',
      '## Objection: I need to think about it',
      '',
      'Acknowledge calmly.',
      '',
      'A useful way to think about it is this: before deciding whether to buy anything, it helps to know where the sales leaks are.',
      '',
      'The AI Automation Session gives clarity using real numbers, not guesswork.',
      '',
      '## Objection: We are not ready',
      '',
      'Most businesses do not feel fully ready because their sales process is still partly manual.',
      '',
      'That is exactly why the AI Automation Session helps.',
      '',
      'We do not need to automate everything on day one. We first identify the biggest leaks, then decide what is worth automating first.',
      '',
      '## Objection: Can I just use ChatGPT?',
      '',
      'ChatGPT can help write replies or scripts.',
      '',
      'AI Sales Bot Pro is not just a script generator. It helps turn the actual sales process into a working AI Automated Sales System with instant replies, qualification, follow-up, booking push, reminders, reactivation, and human handover rules.',
      '',
      '## Objection: AI cannot sell like a human',
      '',
      'Agree partly, then reframe.',
      '',
      'AI should not replace a strong human closer for high-value conversations.',
      '',
      'The bigger leak is usually earlier: slow replies, no follow-up, repeated questions, forgotten leads, no reminders, weak objection handling, and prospects going cold.',
      '',
      'AI Sales Bot Pro helps make sure every lead is handled properly before the human team steps in.',
      '',
      '## Objection: My business is different',
      '',
      'Every business has different offers, customer questions, objections, pricing logic, sales process, and sales leaks.',
      '',
      'That is why the AI Automation Session is useful. It helps understand the actual process and identify what should be automated first.',
    ].join('\n'),
  },
  {
    title: 'Price and ROI Framing',
    content: [
      '## Price, pricing, cost, fee, package, rate',
      '',
      'Pricing is only discussed during the 45-minute AI Automation Session.',
      '',
      'The reason is simple: price does not mean much until we understand the business\'s lead flow, sales process, follow-up gaps, automation scope, and ROI potential.',
      '',
      'Do not fabricate prices.',
      '',
      '## Value framing',
      '',
      'Do not position AI Sales Bot Pro as another software cost.',
      '',
      'Position it against:',
      '- missed leads',
      '- slow replies',
      '- weak follow-up',
      '- no-shows where applicable',
      '- staff time',
      '- lost opportunities',
      '- manual chasing',
      '- poor lead conversion',
      '',
      '## ROI calculator',
      '',
      'AI Sales Bot Pro has an ROI calculator that helps estimate potential return based on real business numbers.',
      '',
      'The calculator can look at:',
      '- lead volume',
      '- response time',
      '- booking rate where applicable',
      '- show-up rate where applicable',
      '- close rate',
      '- average deal value',
      '- staff time',
      '- missed follow-ups',
      '- no-shows where applicable',
      '',
      '## $100K and 30% sales increase claim',
      '',
      'Use responsible wording.',
      '',
      'Do not guarantee that every business will save $100K or increase sales by 30%.',
      '',
      'Say:',
      '"The goal of the AI Automation Session is to see, using your real numbers, where AI Sales Bot Pro can help save cost, recover missed revenue, and potentially increase sales by 30% or more."',
      '',
      '## If prospect pushes for price',
      '',
      'Say:',
      '"I understand you want the price first. I just do not want to throw out a number without knowing your lead volume, sales process, follow-up gaps, and automation scope, because price without ROI does not give the full picture."',
    ].join('\n'),
  },
  {
    title: 'AI Automation Session Positioning',
    content: [
      '## AI Automation Session',
      '',
      'The AI Automation Session is a 45-minute business review.',
      '',
      'Do not call it a discovery call.',
      'Do not call it a mapping call.',
      '',
      'It reviews:',
      '- current lead flow',
      '- response speed',
      '- follow-up process',
      '- booking or sales process',
      '- missed opportunities',
      '- manual workload',
      '- staff bottlenecks',
      '- sales leaks',
      '- no-show issues where applicable',
      '- quote follow-up where applicable',
      '- automation opportunities',
      '- real business numbers',
      '',
      '## Positioning',
      '',
      'The session is not a gimmick.',
      'The session is not a generic sales pitch.',
      '',
      'It is a practical review focused on sales leakage, revenue recovery, staff efficiency, automation opportunities, and measurable business growth.',
      '',
      '## Main promise',
      '',
      'The session helps the prospect see where money may already be leaking from slow replies, missed follow-ups, no-shows, weak conversion, manual chasing, and inconsistent sales conversations.',
      '',
      '## Closing language',
      '',
      'Use:',
      '"The best next step is the 45-minute AI Automation Session."',
      '',
      'Use:',
      '"Let\'s look at your real numbers first."',
      '',
      'Use:',
      '"From what you shared, this sounds worth auditing properly."',
      '',
      'Use:',
      '"That is exactly what we uncover in the AI Automation Session."',
    ].join('\n'),
  },
  {
    title: 'Industry-Neutral Sales Diagnosis Framework',
    content: [
      '## Universal business diagnosis',
      '',
      'Do not be industry biased.',
      '',
      'AI Sales Bot Pro can be explained using a universal business framework that works across industries.',
      '',
      'For any business, diagnose:',
      '- where enquiries come from',
      '- how fast the business replies',
      '- what happens after the first reply',
      '- whether prospects are qualified',
      '- whether follow-up happens consistently',
      '- whether interested leads are guided toward booking, purchase, consultation, quotation, or next step',
      '- whether no-shows, cold leads, or dormant leads are recovered',
      '- whether staff spend too much time on repetitive replies',
      '- whether the business knows where leads drop off',
      '- whether automation can save time, money, and effort',
      '',
      '## Appointment-based business',
      '',
      'Talk about bookings, reminders, no-shows, show-up rate, appointment conversion, and reactivation.',
      '',
      '## Quotation-based business',
      '',
      'Talk about enquiry handling, qualification, quote follow-up, response speed, and lead conversion.',
      '',
      '## Ecommerce or retail business',
      '',
      'Talk about product questions, abandoned enquiries, repeat purchase, reviews, customer support, and repeat sales automation.',
      '',
      '## B2B business',
      '',
      'Talk about lead qualification, appointment setting, sales follow-up, pipeline speed, manual chasing, and decision-maker follow-up.',
      '',
      '## Service business',
      '',
      'Talk about WhatsApp enquiries, job requests, service questions, follow-up, quotation, appointment, no-show where applicable, and repeat customer reactivation.',
    ].join('\n'),
  },
  {
    title: 'Bot and Intake Detection Examples',
    content: [
      '## Bot, chatbot, auto-reply, intake form, menu, business WhatsApp',
      '',
      'Some AISBP outreach contacts may have automated business replies, intake forms, menus, or AI chatbots.',
      '',
      'First check for human intent.',
      '',
      'A short reply can still be human. If the person asks a question, objects, says not now, asks price, asks who we are, asks how it works, says send details, or responds naturally, treat it as a real human reply.',
      '',
      '## Clear auto-reply or intake form',
      '',
      'If the latest message is clearly an auto-reply, intake form, menu, or chatbot from the contact\'s business, do not behave like their customer.',
      '',
      'Do not:',
      '- answer their intake questions',
      '- provide fake customer details',
      '- choose service options',
      '- follow their booking link',
      '- ask to book their service',
      '- pretend to be buying from them',
      '',
      '## Routing reply',
      '',
      'Use:',
      '"Thanks, just to clarify — this is not a customer enquiry. I\'m trying to reach the owner, manager, or person handling enquiries regarding the message we sent earlier. Could you route this to the right person?"',
      '',
      '## Examples of auto-reply or intake form',
      '',
      'Examples:',
      '"Thank you for contacting us. Please provide your name, service required, preferred date and symptoms."',
      '',
      'Examples:',
      '"Please choose an option: 1 for booking, 2 for pricing, 3 for location."',
      '',
      'Examples:',
      '"How can I assist you today?"',
      '',
      'Examples:',
      '"Please send your location, photo, model number, and preferred appointment time."',
      '',
      '## If still automated',
      '',
      'If the next reply still looks automated, stop replying or mark the conversation as bot/auto-reply detected if that capability exists.',
    ].join('\n'),
  },
  {
    title: 'Setup and Onboarding Explanation',
    content: [
      '## Setup, onboarding, implementation',
      '',
      'Setup is meant to be simple for the business owner.',
      '',
      'The business owner does not need to be technical.',
      '',
      '## What setup reviews',
      '',
      'Setup may involve reviewing:',
      '- current enquiries',
      '- offers',
      '- FAQs',
      '- sales process',
      '- follow-up style',
      '- customer objections',
      '- reminders',
      '- no-show recovery where applicable',
      '- dormant lead reactivation',
      '- human handover rules',
      '- booking or sales process',
      '- quote follow-up where applicable',
      '',
      '## Simple explanation',
      '',
      'The goal is to turn the current sales process into a more consistent AI-assisted flow.',
      '',
      'The AI Sales Agent should know what to answer, what to avoid, when to push the next step, and when to hand over to a human.',
      '',
      '## Technical questions',
      '',
      'Avoid technical language unless the prospect specifically asks.',
      '',
      'Use business-friendly terms like:',
      '- AI Sales Agent',
      '- AI automation',
      '- sales automation',
      '- follow-up system',
      '- lead handling',
      '- sales process',
      '- human handover',
      '- booking reminder',
      '- lead reactivation',
      '',
      'Avoid technical terms like:',
      '- API',
      '- backend',
      '- database',
      '- middleware',
      '- CRM architecture',
    ].join('\n'),
  },
  {
    title: 'Sales Leak Examples',
    content: [
      '## Sales leaks, missed leads, missed revenue, lost opportunities',
      '',
      'AI Sales Bot Pro should help prospects identify hidden sales leaks.',
      '',
      'Common sales leaks include:',
      '- slow replies to new leads',
      '- missed WhatsApp enquiries',
      '- after-hours enquiries with no instant response',
      '- staff replying inconsistently',
      '- prospects asking questions but not being guided to the next step',
      '- no structured follow-up after first reply',
      '- weak objection handling',
      '- weak quote follow-up',
      '- no reminder system where appointments are involved',
      '- poor show-up rate where appointments are involved',
      '- no no-show recovery where appointments are involved',
      '- leads going cold after price enquiries',
      '- no dormant lead reactivation',
      '- no abandoned enquiry recovery',
      '- too much manual chasing',
      '- repetitive customer questions',
      '- no clear human handover',
      '- no clear tracking of where leads drop off',
      '- no clear calculation of lost revenue',
      '',
      '## Deeper sales leaks',
      '',
      'Some businesses do not only lose leads because they reply slowly.',
      '',
      'They also lose leads because customers do not understand the value fast enough.',
      '',
      'Examples:',
      '- business owner has to manually explain the same value repeatedly',
      '- customised work requires relevant examples before customers understand',
      '- prospects are interested but do not understand how the solution applies to them',
      '- sales process depends too much on manual demo preparation or manual follow-up',
      '- leads go cold because there is no automated education, nurturing, or objection handling',
    ].join('\n'),
  },
];

// --------------- main ---------------

async function main() {
  console.log(`🔍 Tenant: ${TENANT_ID}`);
  console.log(`🔍 Vault: "${VAULT_NAME}"`);

  // === Step 1: find or create vault ===
  let { data: vault } = await supabase
    .from('knowledge_vaults')
    .select('id, name')
    .eq('tenant_id', TENANT_ID)
    .eq('name', VAULT_NAME)
    .maybeSingle();

  if (vault) {
    console.log(`✅ Vault exists: ${vault.id} («${vault.name}»)`);
  } else {
    const vaultId = randomUUID();
    const now = new Date().toISOString();
    const { error } = await supabase.from('knowledge_vaults').insert({
      id: vaultId,
      tenant_id: TENANT_ID,
      name: VAULT_NAME,
      description: 'AI Sales Bot Pro agency knowledge vault.',
      is_default: false,
      created_at: now,
      updated_at: now,
    });
    if (error) throw new Error(`Vault insert: ${error.message}`);
    vault = { id: vaultId, name: VAULT_NAME };
    console.log(`✅ Vault created: ${vaultId} («${VAULT_NAME}»)`);
  }

  const vaultId = vault.id;

  // === Step 2: count existing documents ===
  const { count: beforeCount } = await supabase
    .from('knowledge_documents')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .eq('vault_id', vaultId);
  console.log(`📄 Existing docs in vault: ${beforeCount ?? 0}`);

  // === Step 3: check active profile access ===
  const { data: activeProfile } = await supabase
    .from('tenant_bot_profiles')
    .select('id, name, knowledge_access_mode')
    .eq('tenant_id', TENANT_ID)
    .eq('is_active', true)
    .maybeSingle();

  const accessMode = String(activeProfile?.['knowledge_access_mode'] ?? '').trim();
  console.log(`🔑 Active profile: ${activeProfile?.name ?? 'none'} (${activeProfile?.id ?? 'none'})`);
  console.log(`🔑 knowledge_access_mode: ${accessMode || 'all_vaults (default)'}`);

  // === Step 4: insert/update FAQs ===
  let faqCreated = 0;
  let faqUpdated = 0;
  let faqSkipped = 0;

  for (const faq of FAQS) {
    const docTitle = faqTitle(faq.question);
    const oldDocTitle = faqOldTitle(faq.question);

    // Check existing by new OR old title
    const { data: existing } = await supabase
      .from('knowledge_documents')
      .select('id, title')
      .eq('tenant_id', TENANT_ID)
      .eq('vault_id', vaultId)
      .in('title', [docTitle, oldDocTitle])
      .maybeSingle();

    if (existing) {
      const wasOldTitle = existing.title === oldDocTitle;
      // Update existing doc + replace chunk
      const { error: updErr } = await supabase
        .from('knowledge_documents')
        .update({
          title: docTitle, // rename if old prefix
          size: faq.answer.length,
          metadata: { question: faq.question, documentKind: 'faq' },
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (updErr) throw new Error(`FAQ update doc: ${updErr.message}`);

      // Replace chunk
      await supabase.from('knowledge_chunks').delete().eq('document_id', existing.id);
      const chunkId = randomUUID();
      const { error: chunkErr } = await supabase.from('knowledge_chunks').insert({
        id: chunkId,
        document_id: existing.id,
        content: faq.answer,
        token_count: Math.ceil(faq.answer.length / 4),
        metadata: { kind: 'faq' },
      });
      if (chunkErr) throw new Error(`FAQ update chunk: ${chunkErr.message}`);
      if (wasOldTitle) {
        console.log(`   ↳ Renamed: "${oldDocTitle.slice(0, 50)}..." → "${docTitle.slice(0, 50)}..."`);
      }
      faqUpdated++;
    } else {
      // Create new
      const docId = randomUUID();
      const now = new Date().toISOString();
      const { error: docErr } = await supabase
        .from('knowledge_documents')
        .insert({
          id: docId,
          tenant_id: TENANT_ID,
          vault_id: vaultId,
          title: docTitle,
          source: 'faq',
          mime_type: 'text/plain',
          size: faq.answer.length,
          status: 'READY',
          metadata: { question: faq.question, documentKind: 'faq' },
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single();
      if (docErr) throw new Error(`FAQ insert doc: ${docErr.message}`);

      const chunkId = randomUUID();
      const { error: chunkErr } = await supabase.from('knowledge_chunks').insert({
        id: chunkId,
        document_id: docId,
        content: faq.answer,
        token_count: Math.ceil(faq.answer.length / 4),
        metadata: { kind: 'faq' },
      });
      if (chunkErr) throw new Error(`FAQ insert chunk: ${chunkErr.message}`);
      faqCreated++;
    }
  }

  console.log(`📝 FAQs: ${faqCreated} created, ${faqUpdated} updated, ${faqSkipped} skipped`);

  // === Step 5: insert/update Rich Text Notes ===
  let noteCreated = 0;
  let noteUpdated = 0;
  let noteSkipped = 0;

  for (const note of NOTES) {
    const oldTitle = noteOldTitle(note.title);

    // Check existing by new OR old title
    const { data: existing } = await supabase
      .from('knowledge_documents')
      .select('id, title')
      .eq('tenant_id', TENANT_ID)
      .eq('vault_id', vaultId)
      .in('title', [note.title, oldTitle])
      .maybeSingle();

    if (existing) {
      const wasOldTitle = existing.title === oldTitle;
      // Update existing
      const { error: updErr } = await supabase
        .from('knowledge_documents')
        .update({
          title: note.title, // rename if old prefix
          size: note.content.length,
          metadata: { documentKind: 'rich_text', richTextContent: note.content },
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (updErr) throw new Error(`Note update doc: ${updErr.message}`);

      // Delete old chunks and re-chunk
      await supabase.from('knowledge_chunks').delete().eq('document_id', existing.id);

      // Simple section splitting by ## headings
      const sections = splitSections(note.content);
      const chunkRows = sections.map((sec) => ({
        id: randomUUID(),
        document_id: existing.id,
        content: sec.body,
        token_count: Math.ceil(sec.body.length / 4),
        metadata: {
          chunkType: 'section',
          sectionTitle: sec.title || null,
          sectionIndex: sec.index,
          sectionPartIndex: 0,
          documentTitle: note.title,
          charCount: sec.body.length,
          documentUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          kind: 'rich_text',
        },
      }));

      if (chunkRows.length > 0) {
        const { error: chunkErr } = await supabase.from('knowledge_chunks').insert(chunkRows);
        if (chunkErr) throw new Error(`Note update chunks: ${chunkErr.message}`);
      }
      noteUpdated++;
    } else {
      // Create new
      const docId = randomUUID();
      const now = new Date().toISOString();
      const { error: docErr } = await supabase
        .from('knowledge_documents')
        .insert({
          id: docId,
          tenant_id: TENANT_ID,
          vault_id: vaultId,
          title: note.title,
          source: 'rich_text',
          mime_type: 'text/plain',
          size: note.content.length,
          status: 'READY',
          metadata: { documentKind: 'rich_text', richTextContent: note.content },
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single();
      if (docErr) throw new Error(`Note insert doc: ${docErr.message}`);

      const sections = splitSections(note.content);
      const chunkRows = sections.map((sec) => ({
        id: randomUUID(),
        document_id: docId,
        content: sec.body,
        token_count: Math.ceil(sec.body.length / 4),
        metadata: {
          chunkType: 'section',
          sectionTitle: sec.title || null,
          sectionIndex: sec.index,
          sectionPartIndex: 0,
          documentTitle: note.title,
          charCount: sec.body.length,
          documentUpdatedAt: now,
          updatedAt: now,
          kind: 'rich_text',
        },
      }));

      if (chunkRows.length > 0) {
        const { error: chunkErr } = await supabase.from('knowledge_chunks').insert(chunkRows);
        if (chunkErr) throw new Error(`Note insert chunks: ${chunkErr.message}`);
      }
      noteCreated++;
    }
  }

  console.log(`📝 Notes: ${noteCreated} created, ${noteUpdated} updated, ${noteSkipped} skipped`);

  // === Step 6: final count ===
  const { count: afterCount } = await supabase
    .from('knowledge_documents')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .eq('vault_id', vaultId);
  console.log(`📄 Final docs in vault: ${afterCount ?? 0}`);

  // === Step 7: vault access ===
  if (accessMode === 'selected_vaults' && activeProfile?.id) {
    // Link vault to profile
    const { data: existingLink } = await supabase
      .from('tenant_bot_profile_knowledge_vaults')
      .select('profile_id')
      .eq('profile_id', activeProfile.id)
      .eq('vault_id', vaultId)
      .maybeSingle();

    if (!existingLink) {
      const { error } = await supabase
        .from('tenant_bot_profile_knowledge_vaults')
        .insert({ profile_id: activeProfile.id, vault_id: vaultId });
      if (error) {
        console.warn(`⚠️ Could not link vault to profile: ${error.message}`);
      } else {
        console.log(`🔗 Vault linked to profile ${activeProfile.id}`);
      }
    } else {
      console.log('🔗 Vault already linked to profile');
    }
  } else if (accessMode !== 'selected_vaults') {
    console.log('🔓 knowledge_access_mode is all_vaults — no explicit vault link needed');
  }

  console.log('\n✅ Done.');
}

// --------------- section splitting ---------------

interface Section {
  title: string | null;
  body: string;
  index: number;
}

function splitSections(text: string): Section[] {
  const lines = text.split('\n');
  const sections: { title: string | null; bodyLines: string[] }[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentLines.length > 0 || currentTitle) {
        sections.push({ title: currentTitle, bodyLines: currentLines });
      }
      currentTitle = headingMatch[1]!.trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0 || currentTitle) {
    sections.push({ title: currentTitle, bodyLines: currentLines });
  }

  return sections.map((sec, i) => ({
    title: sec.title,
    body: sec.bodyLines.join('\n').trim(),
    index: i,
  }));
}

// --------------- run ---------------

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
