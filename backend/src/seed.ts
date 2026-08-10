/**
 * Seeds a demo mailbox so the dashboard has data before any OAuth account is
 * connected. Run with: npm run seed
 */
import { connectDb, disconnectDb } from './config/db';
import { DEFAULT_SETTINGS, User } from './models/user.model';
import { Email } from './models/email.model';
import { Template } from './models/template.model';
import { Activity } from './models/activity.model';
import { logger } from './utils/logger';

const DEMO_EMAIL = 'service.lahore@compsi.com.pk';

const seedEmails = [
  {
    fromName: 'Ayesha Siddiqui',
    fromEmail: 'ayesha.s@nexgen-textiles.com',
    subject: 'ProBook 450 G9 not powering on — warranty claim',
    body: 'Hi team,\n\nOne of our HP ProBook 450 G9 laptops shuts down roughly two minutes after boot. Serial 5CD2419KLM, purchased March 2025 so warranty should still be active. Invoice attached.\n\nCan someone collect it from our Gulberg office this week?\n\nRegards,\nAyesha',
    status: 'pending' as const,
    category: 'support' as const,
    priority: 'high' as const,
    aiConfidence: 74,
    aiReason: 'Warranty date needs a human check before we commit to a pickup window.',
    hoursAgo: 2,
    attachments: [{ filename: 'warranty-invoice.pdf', mimeType: 'application/pdf', size: 246_784 }],
  },
  {
    fromName: 'Bilal Ahmed',
    fromEmail: 'accounts@zenithpharma.pk',
    subject: 'Invoice INV-2026-0841 — payment confirmation',
    body: 'Payment against invoice INV-2026-0841 was released this morning via bank transfer. Advice attached. Kindly share the stamped receipt for our records.',
    status: 'replied' as const,
    category: 'invoice' as const,
    priority: 'medium' as const,
    aiConfidence: 97,
    aiReason: 'Known sender, matched invoice number, standard acknowledgement.',
    hoursAgo: 3,
    attachments: [{ filename: 'payment-advice.pdf', mimeType: 'application/pdf', size: 98_304 }],
  },
  {
    fromName: 'Fatima Noor',
    fromEmail: 'f.noor@alkaram-logistics.com',
    subject: 'LaserJet M428 printing faint pages after toner swap',
    body: 'Our LaserJet Pro M428fdw prints very faint on the left third of the page. We changed the toner last Thursday with a genuine HP cartridge. Do we need an engineer visit?',
    status: 'unread' as const,
    category: 'support' as const,
    priority: 'medium' as const,
    aiConfidence: 91,
    aiReason: 'Common fault pattern with a documented first-line fix.',
    hoursAgo: 4,
    attachments: [],
  },
  {
    fromName: 'Zeeshan Malik',
    fromEmail: 'z.malik@horizon-builders.pk',
    subject: 'Quote request: 12 x EliteBook 840 G11 + docks',
    body: 'We are refreshing our site office fleet. Please quote 12 x HP EliteBook 840 G11 (i7/16GB/512GB), 12 x Thunderbolt dock G4 and 3-year onsite warranty. Delivery to DHA Phase 6. Need it by Monday.',
    status: 'unread' as const,
    category: 'sales' as const,
    priority: 'high' as const,
    aiConfidence: 88,
    aiReason: 'Order value above the auto-send limit — routed to a human for pricing.',
    hoursAgo: 20,
    attachments: [],
  },
  {
    fromName: 'Sana Iqbal',
    fromEmail: 'sana.iqbal@meridian-edu.org',
    subject: 'DesignJet T650 plotter — repeat paper jam',
    body: 'This is the third jam this month. Your engineer visited on 14 July but the fault is back and we have a print deadline on Friday. Please escalate.',
    status: 'failed' as const,
    category: 'support' as const,
    priority: 'high' as const,
    aiConfidence: 82,
    aiReason: 'Delivery failed: recipient server rejected the message (mailbox full).',
    hoursAgo: 26,
    attachments: [{ filename: 'jam-photo.jpg', mimeType: 'image/jpeg', size: 1_258_291 }],
  },
  {
    fromName: 'Nadia Aslam',
    fromEmail: 'nadia.aslam@brightpath-hr.com',
    subject: 'Reference check request — former employee',
    body: 'We are conducting a reference check for a candidate who lists your company as a previous employer between 2022 and 2025. Could you confirm the employment dates and role?',
    status: 'pending' as const,
    category: 'hr' as const,
    priority: 'medium' as const,
    aiConfidence: 61,
    aiReason: 'Low confidence: the request involves personal data, so it must not auto-send.',
    hoursAgo: 50,
    attachments: [],
  },
];

const seedTemplates = [
  { name: 'Warranty claim acknowledgement', category: 'support', body: 'Thank you for the details. We have logged this as job card {{jobCard}} against serial {{serial}}. Warranty status is being confirmed and we will arrange collection.', usageCount: 412 },
  { name: 'Payment received — receipt to follow', category: 'invoice', body: 'Thank you — we have matched your advice to invoice {{invoiceNo}} and marked it received. The stamped receipt will reach you within one working day.', usageCount: 196 },
  { name: 'Quotation acknowledgement', category: 'sales', body: 'Thank you for the requirement. We have registered it as quote request {{quoteNo}} and the formal quotation will reach you by {{date}}.', usageCount: 141 },
  { name: 'Route to HR mailbox', category: 'hr', body: 'Employment verification is handled by our HR department. Please send your request, with the candidate written consent, to hr@example.com.', usageCount: 29 },
];

async function main() {
  await connectDb();

  let user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) {
    user = await User.create({
      name: 'Demo Operator',
      email: DEMO_EMAIL,
      provider: 'microsoft',
      providerAccountId: 'demo-seed-account',
      settings: {
        ...DEFAULT_SETTINGS,
        signature: 'Customer Care Centre\nservice.lahore@compsi.com.pk',
      },
    });
    logger.info(`Created demo user ${user.email}`);
  }

  await Email.deleteMany({ userId: user._id });
  await Template.deleteMany({ userId: user._id });
  await Activity.deleteMany({ userId: user._id });

  for (const [i, e] of seedEmails.entries()) {
    const receivedAt = new Date(Date.now() - e.hoursAgo * 3600_000);
    await Email.create({
      userId: user._id,
      externalId: `seed-${i + 1}`,
      threadId: `seed-thread-${i + 1}`,
      fromName: e.fromName,
      fromEmail: e.fromEmail,
      toEmail: user.email,
      subject: e.subject,
      snippet: e.body.slice(0, 140),
      body: e.body,
      receivedAt,
      status: e.status,
      category: e.category,
      priority: e.priority,
      attachments: e.attachments,
      aiReply: `Hello ${e.fromName.split(' ')[0]},\n\nThank you for your email. We have logged your request and our team is reviewing it now. We will confirm the next step shortly.`,
      aiConfidence: e.aiConfidence,
      aiReason: e.aiReason,
      aiModel: 'seed',
      aiGeneratedAt: receivedAt,
      sentAt: e.status === 'replied' ? new Date(receivedAt.getTime() + 60_000) : undefined,
      responseTimeMs: e.status === 'replied' ? 60_000 : undefined,
      failureReason: e.status === 'failed' ? 'Recipient mailbox full (552)' : undefined,
      thread: [
        {
          from: e.fromEmail,
          fromName: e.fromName,
          outbound: false,
          body: e.body,
          sentAt: receivedAt,
        },
      ],
    });
  }

  await Template.insertMany(seedTemplates.map((t) => ({ ...t, userId: user!._id })));
  await Activity.insertMany([
    { userId: user._id, type: 'sync', title: 'Mailbox synced', detail: `${seedEmails.length} messages` },
    { userId: user._id, type: 'ai_generated', title: 'AI generated reply', detail: 'Confidence 94%' },
  ]);

  logger.info(`Seeded ${seedEmails.length} emails and ${seedTemplates.length} templates`);
  await disconnectDb();
}

main().catch((e) => {
  logger.error('Seed failed', e);
  process.exit(1);
});
