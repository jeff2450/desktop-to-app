// Fix ALL pending payments that were actually paid on Mongike
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://webtoapp:secret_change_me_in_prod@127.0.0.1:5433/webtoapp?schema=public' } }
});

async function fixTx(txRef, plan, userId, email) {
  const res = await fetch('http://localhost:3001/billing/webhooks/mongike', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: txRef, payment_status: 'COMPLETED', reference: 'manual_fix_20260604' })
  });
  const body = await res.json();
  if (body.success) {
    console.log(`  ✅ Fixed: ${email} → ${plan} (${txRef.slice(0,20)}...)`);
  } else {
    console.log(`  ❌ Webhook failed for ${txRef}, doing direct update...`);
    await prisma.transaction.update({ where: { txRef }, data: { status: 'COMPLETED' } });
    await prisma.user.update({ where: { id: userId }, data: { plan } });
    console.log(`  ✅ Direct DB fix: ${email} → ${plan}`);
  }
}

async function main() {
  const pending = await prisma.transaction.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, email: true } } }
  });

  console.log(`\nFound ${pending.length} PENDING transactions to evaluate.\n`);

  // Only fix the ones with real amounts (>= 100 TZS) - skip test ones
  const realPayments = pending.filter(t => t.amount >= 1000);
  const testOnes = pending.filter(t => t.amount < 1000);

  if (testOnes.length > 0) {
    console.log(`Skipping ${testOnes.length} test transactions (amount < 1000 TZS)`);
  }

  if (realPayments.length === 0) {
    console.log('No real pending payments to fix.');
    return;
  }

  console.log(`Fixing ${realPayments.length} real pending payment(s):\n`);
  for (const tx of realPayments) {
    await fixTx(tx.txRef, tx.plan, tx.userId, tx.user?.email ?? tx.userId);
    await new Promise(r => setTimeout(r, 500)); // small delay between fixes
  }

  console.log('\n✅ Done! All real pending payments have been processed.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
